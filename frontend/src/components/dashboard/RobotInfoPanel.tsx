import { useSimulation } from '../../simulation/SimulationProvider';
import { FieldRow } from '../ui/FieldRow';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { StatusBadge } from '../ui/StatusBadge';

export function RobotInfoPanel() {
  const { snapshot } = useSimulation();
  const telemetry = snapshot.telemetry;
  const live =
    snapshot.connectionStatus === 'connected' &&
    telemetry !== null &&
    !snapshot.stale;
  const yawDegrees = telemetry ? (telemetry.pose.yaw * 180) / Math.PI : null;

  return (
    <Panel
      eyebrow="Robot"
      title="AGV-07"
      className="robot-info-panel"
      actions={
        <StatusBadge tone={live ? 'success' : 'warning'} dot>
          {live ? 'Live telemetry' : 'Awaiting backend'}
        </StatusBadge>
      }
    >
      <div className="robot-card">
        <div className="robot-card__schematic" aria-hidden="true">
          <svg viewBox="0 0 170 104">
            <defs>
              <linearGradient id="agvBody" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#e19a3d" />
                <stop offset="1" stopColor="#a75e1c" />
              </linearGradient>
            </defs>
            <rect x="30" y="25" width="110" height="54" rx="11" fill="url(#agvBody)" stroke="#f1bb63" strokeWidth="1.3" />
            <rect x="42" y="36" width="86" height="29" rx="5" fill="#262b30" />
            <rect x="49" y="43" width="45" height="4" rx="2" fill="#69717a" />
            <rect x="49" y="51" width="63" height="3" rx="1.5" fill="#4f565e" />
            <rect x="49" y="57" width="36" height="3" rx="1.5" fill="#4f565e" />
            <circle cx="99" cy="30" r="7.5" fill="#1b2025" stroke="#77c7e5" strokeWidth="1.2" />
            <circle cx="99" cy="30" r="2.4" fill="#77c7e5" />
            <rect x="34" y="21" width="6" height="62" rx="2" fill="#14181c" />
            <rect x="130" y="21" width="6" height="62" rx="2" fill="#14181c" />
            <rect x="41" y="80" width="28" height="9" rx="4.5" fill="#181c20" />
            <rect x="101" y="80" width="28" height="9" rx="4.5" fill="#181c20" />
            <circle cx="47" cy="88" r="12" fill="#0d1013" stroke="#41484f" strokeWidth="2" />
            <circle cx="47" cy="88" r="4" fill="#666f78" />
            <circle cx="123" cy="88" r="12" fill="#0d1013" stroke="#41484f" strokeWidth="2" />
            <circle cx="123" cy="88" r="4" fill="#666f78" />
            <path d="M147 56h13m-4-4 4 4-4 4" stroke="#e4b968" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <text x="31" y="15" fill="#9ea8b1" fontSize="7" letterSpacing="2">
              DIFFERENTIAL DRIVE · LIVE TELEMETRY
            </text>
          </svg>
        </div>

        <div className="robot-card__facts">
          <FieldRow label="Asset" value="AGV-07 warehouse tractor" />
          <FieldRow label="Drive" value="Differential · 0.94 m wheelbase" />
          <FieldRow label="Footprint" value="1.55 × 1.06 m" />
          <FieldRow label="Source of truth" value="/agv_web/ground_truth · Python simulation" />
          <FieldRow
            label="Live pose"
            value={
              telemetry
                ? `X ${telemetry.pose.x.toFixed(2)} · Y ${telemetry.pose.y.toFixed(2)} · ${yawDegrees?.toFixed(1)}°`
                : 'Waiting for /agv_web/ground_truth'
            }
            mono
          />
        </div>
      </div>

      <div className={`notice ${live ? 'notice--success' : 'notice--info'}`}>
        <Icon name={live ? 'check' : 'alert'} size={16} />
        <p>
          {live ? (
            <>
              Pose and velocity are received from the Python backend on <strong>/agv_web/ground_truth</strong>.
              Wheel angles and speeds arrive on <strong>/joint_states</strong>. The browser only
              interpolates between backend states for rendering.
            </>
          ) : (
            <>
              Start the ROS 2 bridge and <strong>simulation_node</strong> to receive authoritative
              pose, wheel feedback and collision status.
            </>
          )}
        </p>
      </div>
    </Panel>
  );
}

