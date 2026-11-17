FROM ros:humble-ros-base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-humble-rosbridge-server ros-humble-slam-toolbox ros-humble-navigation2 \
    ros-humble-nav2-bringup python3-colcon-common-extensions python3-pytest python3-yaml \
    && rm -rf /var/lib/apt/lists/*
COPY ros2_ws/src /opt/agv_ws/src
RUN . /opt/ros/humble/setup.sh && cd /opt/agv_ws && colcon build --symlink-install
WORKDIR /workspace
ENTRYPOINT ["/bin/bash", "-c", "source /opt/ros/humble/setup.bash && source /opt/agv_ws/install/setup.bash && exec \"$@\"", "--"]
CMD ["ros2", "launch", "agv_web_bridge", "agv_fleet.launch.py"]
