"""Save real SLAM pose graphs and restore only maps for this warehouse geometry."""
import hashlib
import json
import math
from pathlib import Path


def geometry_digest(config):
    return hashlib.sha256(('rack-floor-no-drive-v1\n' + json.dumps(config, sort_keys=True)).encode()).hexdigest()


def cached_parameters(manifest, config, world_pose):
    manifest = Path(manifest)
    if not manifest.exists():
        return {}
    item = json.loads(manifest.read_text())
    if not isinstance(item, dict):
        raise ValueError('Invalid saved-map manifest')
    if item.get('geometry') != geometry_digest(config):
        raise ValueError('Saved map geometry differs from this warehouse; remap and save_map again.')
    snapshot = item.get('snapshot')
    if not isinstance(snapshot, str) or Path(snapshot).name != snapshot or snapshot in ('.', '..'):
        raise ValueError('Invalid saved-map snapshot name')
    prefix = manifest.parent / snapshot
    if any(not Path(str(prefix) + suffix).is_file() or Path(str(prefix) + suffix).stat().st_size == 0 for suffix in ('.posegraph', '.data')):
        raise ValueError('Saved SLAM graph is incomplete; remap and save_map again.')
    pose = item.get('world_to_map')
    if not isinstance(pose, list) or len(pose) != 3 or any(type(v) not in (int, float) or not math.isfinite(v) for v in pose):
        raise ValueError('Invalid warehouse-to-map transform')
    x, y, a = pose
    return {'map_file_name': str(prefix.resolve()), 'map_start_pose': [
        float(x + math.cos(a)*world_pose[0] - math.sin(a)*world_pose[1]),
        float(y + math.sin(a)*world_pose[0] + math.cos(a)*world_pose[1]),
        float(a + world_pose[2])], 'map_start_at_dock': False}


def main():
    import argparse
    import time
    import rclpy
    from rclpy.node import Node
    from rclpy.qos import QoSProfile, DurabilityPolicy
    from nav_msgs.msg import Odometry, OccupancyGrid
    from tf2_msgs.msg import TFMessage
    from slam_toolbox.srv import SerializePoseGraph
    from ament_index_python.packages import get_package_share_directory
    parser = argparse.ArgumentParser(description="Save a stopped robot's real SLAM graph for automatic startup restoration.")
    parser.add_argument('--output', default=str(Path.cwd() / 'maps/warehouse.json'))
    args = parser.parse_args()
    config = json.loads((Path(get_package_share_directory('agv_web_bridge')) / 'config/warehouse_collision.json').read_text())
    manifest = Path(args.output).resolve(); manifest.parent.mkdir(parents=True, exist_ok=True)
    rclpy.init(); node = Node('save_warehouse_map'); latest = {}
    def store(key, value):
        latest[key] = (value, time.monotonic())
    node.create_subscription(Odometry, '/odom', lambda m: store('odom', m), 10)
    node.create_subscription(Odometry, '/agv_web/ground_truth', lambda m: store('truth', m), 10)
    node.create_subscription(OccupancyGrid, '/map', lambda m: store('map', m), QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL))
    def tf(message):
        for transform in message.transforms:
            if transform.header.frame_id == 'map' and transform.child_frame_id == 'odom':
                store('tf', transform.transform)
    node.create_subscription(TFMessage, '/tf', tf, 10)
    client = node.create_client(SerializePoseGraph, '/slam_toolbox/serialize_map')
    try:
        deadline = time.monotonic() + 20
        while not (all(k in latest for k in ('odom', 'truth', 'tf', 'map')) and client.service_is_ready()):
            if time.monotonic() > deadline:
                raise RuntimeError('Fresh SLAM, odometry and robot pose are required to save the map.')
            rclpy.spin_once(node, timeout_sec=.05)
        if any(time.monotonic() - latest[k][1] > 1 for k in ('odom', 'truth', 'tf')):
            raise RuntimeError('Localization is stale; map was not saved.')
        odom = latest['odom'][0]
        if abs(odom.twist.twist.linear.x) > .02 or abs(odom.twist.twist.angular.z) > .02:
            raise RuntimeError('Stop the robot before saving its map.')
        grid = latest['map'][0]
        if not any(v == 0 for v in grid.data) or not any(v > 50 for v in grid.data):
            raise RuntimeError('An observed free/occupied SLAM map is required.')
        prefix = manifest.parent / f'{manifest.stem}-{time.time_ns()}'
        request = SerializePoseGraph.Request(); request.filename = str(prefix)
        future = client.call_async(request)
        rclpy.spin_until_future_complete(node, future, timeout_sec=20)
        if not future.done() or future.result().result != 0:
            raise RuntimeError('SLAM pose-graph serialization failed; previous checkpoint retained.')
        transform = latest['tf'][0]; odom = latest['odom'][0].pose.pose; truth = latest['truth'][0].pose.pose
        yaw = lambda q: 2*math.atan2(q.z, q.w)
        a = yaw(transform.rotation) + yaw(odom.orientation) - yaw(truth.orientation)
        map_x = transform.translation.x + math.cos(yaw(transform.rotation))*odom.position.x - math.sin(yaw(transform.rotation))*odom.position.y
        map_y = transform.translation.y + math.sin(yaw(transform.rotation))*odom.position.x + math.cos(yaw(transform.rotation))*odom.position.y
        item = {'geometry': geometry_digest(config), 'snapshot': prefix.name, 'world_to_map': [
            map_x - math.cos(a)*truth.position.x + math.sin(a)*truth.position.y,
            map_y - math.sin(a)*truth.position.x - math.cos(a)*truth.position.y, a]}
        temp = manifest.with_suffix('.json.tmp'); temp.write_text(json.dumps(item, indent=2))
        cached_parameters(temp, config, (0, 0, 0))  # Validate complete files before publishing the manifest.
        temp.replace(manifest)
        print(json.dumps({'saved': str(manifest), 'snapshot': str(prefix), 'map_cells': grid.info.width*grid.info.height}), flush=True)
    finally:
        node.destroy_node(); rclpy.shutdown()


if __name__ == '__main__':
    main()
