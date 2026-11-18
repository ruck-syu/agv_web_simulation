"""Velocity ceilings shared by command arbitration and the physics backend."""
MAX_LINEAR_SPEED = 1.2  # m/s
MAX_ANGULAR_SPEED = 1.2  # rad/s
# Covers 1.2 m/s plus a 1.2 rad/s turn with 0.94 m track and 0.19 m wheels.
MAX_WHEEL_ANGULAR_SPEED = 9.5  # rad/s

SIM_LINEAR_ACCELERATION = 1.2  # m/s², including braking
SIM_ANGULAR_ACCELERATION = 2.5  # rad/s²

FLEET_COMMAND_LIFESPAN = .10  # s, maximum age of a queued velocity command
FLEET_COMMAND_TIMEOUT = .25  # s, robot-side receipt watchdog
FLEET_VELOCITY_TOPIC = "agv_web/fleet_velocity"
