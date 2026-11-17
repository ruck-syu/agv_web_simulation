"""Two robots in one single-threaded authoritative physics process."""
import rclpy
from rclpy.executors import SingleThreadedExecutor
from rclpy.parameter import Parameter
from .simulation_node import SimulationNode, Obstacle

TOPICS = ["/cmd_vel", "/odom", "/joint_states", "/scan", "/scan_obstacles",
          "/agv_web/ground_truth", "/agv_web/odometry_status",
          "/agv_web/collision_status", "/agv_web/collision_geometry"]


def create_robots():
    robots=[]
    for robot_id, x, y in (("agv1",-2.8,1.6),("agv2",4.5,1.6)):
        node=SimulationNode(namespace=robot_id,
            cli_args=["--ros-args"]+[arg for topic in TOPICS for arg in ("-r", f"{topic}:=/{robot_id}{topic}")],
            parameter_overrides=[Parameter("frame_prefix",value=robot_id+"/"),
                                 Parameter("initial_x",value=x),Parameter("initial_y",value=y)])
        robots.append(node)
    for node in robots:
        node.dynamic_obstacles=lambda node=node: [Obstacle(
            id=peer.get_namespace().strip("/"),type="robot",cx=peer.x,cy=peer.y,
            hx=peer.half_length,hy=peer.half_width,yaw=peer.yaw,max_z=1.2)
            for peer in robots if peer is not node]
        if node._current_collision():
            raise RuntimeError("Fleet spawn overlaps static geometry or another robot")
    return robots


def main(args=None):
    rclpy.init(args=args)
    nodes=create_robots(); executor=SingleThreadedExecutor()
    for node in nodes:
        executor.add_node(node)
    try:
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        executor.shutdown()
        for node in nodes:
            node.destroy_node()
        rclpy.shutdown()
