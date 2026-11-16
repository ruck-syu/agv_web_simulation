# Phase 3/4 Runtime Test Results

Generated: 2026-11-15 14:36:14

| # | Test | Result | Measurements |
|---|------|--------|--------------|
| 1 | forward | PASS | Δx=0.385 m, Δy=0.0000 m, Δyaw=0.0000 rad, wheels=1.053/1.053 rad/s |
| 2 | backward | PASS | Δx=-0.385 m, Δy=0.0000 m, Δyaw=0.0000 rad, wheels=-1.053/-1.053 rad/s |
| 3 | turn_left | PASS | Δyaw=0.585 rad, drift=0.0000 m, wheels=-0.742/0.742 rad/s |
| 4 | turn_right | PASS | Δyaw=-0.585 rad, drift=0.0000 m, wheels=0.742/-0.742 rad/s |
| 5 | stop | PASS | v=0.0000 m/s, ω=0.0000 rad/s, post-zero travel=0.0187 m |
| 6 | wall_collision | PASS | blocked=True, object=wall_north, front edge=19.697 m, v=0.0000 m/s |
| 7 | rack_collision | PASS | blocked=True, object=RACK-C-01-07-N-FOOTPLATE, front edge=-0.876 m, v=0.0000 m/s |
| 8 | pallet_collision | PASS | blocked=True, object=PALLET-STAGE-01, front edge=-11.368 m, v=0.0000 m/s |
| 9 | rotate_near_rack | PASS | blocked=True, object=RACK-C-01-07-N-FOOTPLATE, Δyaw=0.465 rad, ω=0.0000 rad/s |
| 10 | cmd_timeout | PASS | timed_out=True, active=False, v=0.0000 m/s, travel=0.1147 m |
| 11 | aisle_center | PASS | Δx=4.689 m, blocked=False, object=None, final=(-15.311, 1.600) |
| 12 | aisle_edge_clearance | PASS | Δx=2.929 m, blocked=False, object=None, final=(-17.071, 3.450) |
| 13 | aisle_ab_center | PASS | Δx=3.921 m, blocked=False, object=None, final=(-14.079, 9.200) |
| 14 | aisle_cd_center | PASS | Δx=3.937 m, blocked=False, object=None, final=(-14.063, -6.000) |
| 15 | rotate_in_aisle | PASS | Δyaw=1.935 rad, drift=0.0000 m, blocked=False, object=None |
| 16 | rack_leg_collision | PASS | blocked=True, object=RACK-B-02-07-S-FOOTPLATE, front edge=4.076 m, v=0.0000 m/s |
| 17 | under_rack_transit | PASS | Δy=3.936 m, final y=7.486 m, blocked=False |
| 18 | under_rack_low_clearance | PASS | blocked=True, object=RACK-B-02-SHELF-L1, front edge=4.176 m, v=0.0000 m/s |

**18/18 tests passed.**

## Checks

### 1. forward — PASS

- Command: linear.x=0.2 m/s, angular.z=0.0 rad/s for 2.0 s
- `forward_displacement_m`: {"value": 0.3853, "min": 0.15}
- `lateral_drift_m`: {"value": 0.0, "max": 0.05}
- `heading_drift_rad`: {"value": 0.0, "max": 0.05}
- `left_wheel_forward_rad_s`: {"value": 1.0526, "min": 0.5}
- `right_wheel_forward_rad_s`: {"value": 1.0526, "min": 0.5}
- `left_wheel_angle_delta_rad`: {"value": 2.0278, "min": 0.5}
- `right_wheel_angle_delta_rad`: {"value": 2.0278, "min": 0.5}

### 2. backward — PASS

- Command: linear.x=-0.2 m/s, angular.z=0.0 rad/s for 2.0 s
- `backward_displacement_m`: {"value": 0.3853, "min": 0.15}
- `lateral_drift_m`: {"value": 0.0, "max": 0.05}
- `heading_drift_rad`: {"value": 0.0, "max": 0.05}
- `left_wheel_backward_rad_s`: {"value": -1.0526, "max": -0.5}
- `right_wheel_backward_rad_s`: {"value": -1.0526, "max": -0.5}

### 3. turn_left — PASS

- Command: linear.x=0.0 m/s, angular.z=0.3 rad/s for 2.0 s
- `yaw_change_rad`: {"value": 0.585, "expected_sign": 1.0, "magnitude_min": 0.2}
- `translation_drift_m`: {"value": 0.0, "max": 0.03}
- `differential_wheel_sign`: {"left": -0.7421, "right": 0.7421, "expected": "right > left"}

### 4. turn_right — PASS

- Command: linear.x=0.0 m/s, angular.z=-0.3 rad/s for 2.0 s
- `yaw_change_rad`: {"value": -0.585, "expected_sign": -1.0, "magnitude_min": 0.2}
- `translation_drift_m`: {"value": 0.0, "max": 0.03}
- `differential_wheel_sign`: {"left": 0.7421, "right": -0.7421, "expected": "left > right"}

### 5. stop — PASS

- Command: linear.x=0.2 m/s, angular.z=0.0 rad/s for 1.0 s
- `velocity_after_stop_m_s`: {"value": 0.0, "max": 0.02}
- `angular_after_stop_rad_s`: {"value": 0.0, "max": 0.02}
- `displacement_after_zero_m`: {"value": 0.0187, "max": 0.05}
- `wheel_speed_after_stop_rad_s`: {"value": 0.0, "max": 0.02}

### 6. wall_collision — PASS

- Command: linear.x=0.35 m/s, angular.z=0.0 rad/s for 3.0 s
- `blocked`: {"value": true, "expected": true}
- `blocked_object_id`: {"value": "wall_north", "expected": "wall_north"}
- `front_edge_y_m`: {"value": 19.6974, "max": 19.71}
- `final_speed_m_s`: {"value": 0.0, "max": 0.02}

### 7. rack_collision — PASS

- Command: linear.x=0.2 m/s, angular.z=0.0 rad/s for 3.0 s
- `blocked`: {"value": true, "expected": true}
- `blocked_object_id`: {"value": "RACK-C-01-07-N-FOOTPLATE", "expected": "RACK-C-01-07-N-FOOTPLATE"}
- `blocked_object_type`: {"value": "rack_base", "expected": "rack_base"}
- `front_edge_y_m`: {"value": -0.8763, "min": -0.9}
- `final_speed_m_s`: {"value": 0.0, "max": 0.02}

### 8. pallet_collision — PASS

- Command: linear.x=0.2 m/s, angular.z=0.0 rad/s for 3.5 s
- `blocked`: {"value": true, "expected": true}
- `blocked_object_id`: {"value": "PALLET-STAGE-01", "expected": "PALLET-STAGE-01"}
- `front_edge_y_m`: {"value": -11.3683, "min": -11.38}
- `final_speed_m_s`: {"value": 0.0, "max": 0.02}

### 9. rotate_near_rack — PASS

- Command: linear.x=0.0 m/s, angular.z=0.3 rad/s for 3.0 s
- `blocked`: {"value": true, "expected": true}
- `blocked_object_id`: {"value": "RACK-C-01-07-N-FOOTPLATE", "expected": "RACK-C-01-07-N-FOOTPLATE"}
- `blocked_object_type`: {"value": "rack_base", "expected": "rack_base"}
- `yaw_change_rad`: {"value": 0.465, "max": 1.5707963267948966}
- `translation_drift_m`: {"value": 0.0, "max": 0.03}
- `final_speed_rad_s`: {"value": 0.0, "max": 0.02}

### 10. cmd_timeout — PASS

- Command: linear.x=0.2 m/s, angular.z=0.0 rad/s for 1.0 s
- `command_timed_out`: {"value": true, "expected": true}
- `command_active`: {"value": false, "expected": false}
- `velocity_after_timeout_m_s`: {"value": 0.0, "max": 0.02}
- `wheel_speed_after_timeout_rad_s`: {"value": 0.0, "max": 0.02}
- `displacement_after_timeout_m`: {"value": 0.1147, "max": 0.2}

### 11. aisle_center — PASS

- Command: linear.x=0.4 m/s, angular.z=0.0 rad/s for 12.0 s
- `forward_displacement_m`: {"value": 4.6893, "min": 2.88}
- `lateral_drift_m`: {"value": 0.0, "max": 0.03}
- `blocked`: {"value": false, "expected": false}
- `collision_state`: {"value": "clear", "expected": "clear"}
- `blocked_object_id`: {"value": null, "expected": null}
- `final_position_ros`: {"x": -15.3107, "y": 1.6}

### 12. aisle_edge_clearance — PASS

- Command: linear.x=0.3 m/s, angular.z=0.0 rad/s for 10.0 s
- `forward_displacement_m`: {"value": 2.9294, "min": 1.7999999999999998}
- `lateral_drift_m`: {"value": 0.0, "max": 0.03}
- `blocked`: {"value": false, "expected": false}
- `collision_state`: {"value": "clear", "expected": "clear"}
- `blocked_object_id`: {"value": null, "expected": null}
- `final_position_ros`: {"x": -17.0706, "y": 3.45}
- `clearance_to_RACK_B_02_base_plate_m`: {"value": 0.1, "min": 0.08}

### 13. aisle_ab_center — PASS

- Command: linear.x=0.4 m/s, angular.z=0.0 rad/s for 10.0 s
- `forward_displacement_m`: {"value": 3.9213, "min": 2.4}
- `lateral_drift_m`: {"value": 0.0, "max": 0.03}
- `blocked`: {"value": false, "expected": false}
- `collision_state`: {"value": "clear", "expected": "clear"}
- `blocked_object_id`: {"value": null, "expected": null}
- `final_position_ros`: {"x": -14.0787, "y": 9.2}

### 14. aisle_cd_center — PASS

- Command: linear.x=0.4 m/s, angular.z=0.0 rad/s for 10.0 s
- `forward_displacement_m`: {"value": 3.9373, "min": 2.4}
- `lateral_drift_m`: {"value": 0.0, "max": 0.03}
- `blocked`: {"value": false, "expected": false}
- `collision_state`: {"value": "clear", "expected": "clear"}
- `blocked_object_id`: {"value": null, "expected": null}
- `final_position_ros`: {"x": -14.0627, "y": -6.0}

### 15. rotate_in_aisle — PASS

- Command: linear.x=0.0 m/s, angular.z=0.5 rad/s for 4.0 s
- `yaw_change_rad`: {"value": 1.935, "min": 1.5, "max": 2.1}
- `translation_drift_m`: {"value": 0.0, "max": 0.04}
- `blocked`: {"value": false, "expected": false}
- `collision_state`: {"value": "clear", "expected": "clear"}

### 16. rack_leg_collision — PASS

- Command: linear.x=0.2 m/s, angular.z=0.0 rad/s for 3.0 s
- `blocked`: {"value": true, "expected": true}
- `blocked_object_id`: {"value": "RACK-B-02-07-S-FOOTPLATE", "expected": "RACK-B-02-07-S-FOOTPLATE"}
- `blocked_object_type`: {"value": "rack_base", "expected": "rack_base"}
- `front_edge_y_m`: {"value": 4.0763, "min": 4.06}
- `final_speed_m_s`: {"value": 0.0, "max": 0.02}

### 17. under_rack_transit — PASS

- Command: linear.x=0.25 m/s, angular.z=0.0 rad/s for 16.0 s
- `forward_displacement_m`: {"value": 3.9364, "min": 3.0}
- `lateral_drift_m`: {"value": 0.0, "max": 0.03}
- `blocked`: {"value": false, "expected": false}
- `collision_state`: {"value": "clear", "expected": "clear"}
- `final_y_m`: {"value": 7.4864, "min": 6.7}
- `robot_height_m`: {"value": 0.96, "max": 1.185}

### 18. under_rack_low_clearance — PASS

- Command: linear.x=0.2 m/s, angular.z=0.0 rad/s for 4.0 s
- `blocked`: {"value": true, "expected": true}
- `blocked_object_id`: {"value": "RACK-B-02-SHELF-L1", "expected": "RACK-B-02-SHELF-L1"}
- `blocked_object_type`: {"value": "rack_shelf", "expected": "rack_shelf"}
- `front_edge_y_m`: {"value": 4.1763, "min": 4.16}
- `shelf_underside_m`: {"value": 1.185, "max": 1.3}
- `final_speed_m_s`: {"value": 0.0, "max": 0.02}
