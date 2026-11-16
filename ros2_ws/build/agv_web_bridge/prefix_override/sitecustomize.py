import sys
if sys.prefix == '/usr':
    sys.real_prefix = sys.prefix
    sys.prefix = sys.exec_prefix = '/home/tharunm/agv_web_simulation/ros2_ws/install/agv_web_bridge'
