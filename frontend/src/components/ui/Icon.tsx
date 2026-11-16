import type { SVGProps } from 'react';

export type IconName =
  | 'wifi'
  | 'wifi-off'
  | 'maximize'
  | 'minimize'
  | 'reset'
  | 'send'
  | 'chevron-right'
  | 'alert'
  | 'check'
  | 'cube'
  | 'robot'
  | 'lidar'
  | 'route'
  | 'layers'
  | 'server'
  | 'terminal'
  | 'close'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-left'
  | 'arrow-right'
  | 'stop';

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

const COMMON = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function Icon({ name, size = 18, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      {...COMMON}
      {...rest}
    >
      {name === 'wifi' && (
        <>
          <path d="M2.5 8.5a15 15 0 0 1 19 0" />
          <path d="M5.5 11.8a10.5 10.5 0 0 1 13 0" />
          <path d="M8.7 15.1a6 6 0 0 1 6.6 0" />
          <circle cx="12" cy="18.5" r="1.1" fill="currentColor" stroke="none" />
        </>
      )}
      {name === 'wifi-off' && (
        <>
          <path d="M3 3l18 18" />
          <path d="M8.6 15.2a6 6 0 0 1 4-1.5" />
          <path d="M5.7 11.9a10.6 10.6 0 0 1 3.1-1.9" />
          <path d="M10.3 8.2a15 15 0 0 1 11.2.3" />
          <circle cx="12" cy="18.5" r="1.1" fill="currentColor" stroke="none" />
        </>
      )}
      {name === 'maximize' && (
        <>
          <path d="M8 3H3v5" />
          <path d="M16 3h5v5" />
          <path d="M21 16v5h-5" />
          <path d="M3 16v5h5" />
        </>
      )}
      {name === 'minimize' && (
        <>
          <path d="M3 8h5V3" />
          <path d="M21 8h-5V3" />
          <path d="M16 21v-5h5" />
          <path d="M8 21v-5H3" />
        </>
      )}
      {name === 'reset' && (
        <>
          <path d="M3.5 7v5h5" />
          <path d="M4.8 12a7.6 7.6 0 1 0 2.1-5.1L3.5 10" />
        </>
      )}
      {name === 'send' && (
        <>
          <path d="M21 3L10.5 13.5" />
          <path d="M21 3l-6.8 18-3.7-7.5L3 9.8 21 3z" />
        </>
      )}
      {name === 'chevron-right' && <path d="M9 5l7 7-7 7" />}
      {name === 'alert' && (
        <>
          <path d="M12 3.5L22 20H2L12 3.5z" />
          <path d="M12 9v5" />
          <circle cx="12" cy="17.2" r="1" fill="currentColor" stroke="none" />
        </>
      )}
      {name === 'check' && <path d="M4.5 12.5l5 5L20 6.5" />}
      {name === 'cube' && (
        <>
          <path d="M12 2.7l8.5 4.8v9L12 21.3l-8.5-4.8v-9L12 2.7z" />
          <path d="M3.8 7.7L12 12.4l8.2-4.7" />
          <path d="M12 12.4v8.6" />
        </>
      )}
      {name === 'robot' && (
        <>
          <rect x="4.5" y="7" width="15" height="11" rx="2.5" />
          <path d="M12 3v4" />
          <circle cx="12" cy="3" r="1" fill="currentColor" stroke="none" />
          <circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none" />
          <path d="M9.5 15.5h5" />
          <path d="M4.5 12H2.5M21.5 12h-2" />
        </>
      )}
      {name === 'lidar' && (
        <>
          <path d="M4 16.5a8 8 0 0 1 16 0" />
          <path d="M8 16.5a4 4 0 0 1 8 0" />
          <circle cx="12" cy="16.5" r="1.1" fill="currentColor" stroke="none" />
          <path d="M3 20h18" />
          <path d="M12 4v3" />
        </>
      )}
      {name === 'route' && (
        <>
          <circle cx="5" cy="6" r="2" />
          <circle cx="19" cy="18" r="2" />
          <path d="M7 6h5a3 3 0 0 1 3 3v6" />
          <path d="M15 12.5l2.5 2.5 2-2" />
        </>
      )}
      {name === 'layers' && (
        <>
          <path d="M12 3l9 5-9 5-9-5 9-5z" />
          <path d="M3 12l9 5 9-5" />
          <path d="M3 16l9 5 9-5" />
        </>
      )}
      {name === 'server' && (
        <>
          <rect x="4" y="3" width="16" height="7" rx="1.5" />
          <rect x="4" y="14" width="16" height="7" rx="1.5" />
          <path d="M7.5 6.5h.01M7.5 17.5h.01" />
          <path d="M11 6.5h6M11 17.5h6" />
        </>
      )}
      {name === 'terminal' && (
        <>
          <rect x="2.5" y="4" width="19" height="16" rx="2" />
          <path d="M6.5 9l3 3-3 3" />
          <path d="M12.5 15h5" />
        </>
      )}
      {name === 'close' && (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </>
      )}
      {name === 'arrow-up' && (
        <>
          <path d="M12 20V4" />
          <path d="M5.5 10.5L12 4l6.5 6.5" />
        </>
      )}
      {name === 'arrow-down' && (
        <>
          <path d="M12 4v16" />
          <path d="M5.5 13.5L12 20l6.5-6.5" />
        </>
      )}
      {name === 'arrow-left' && (
        <>
          <path d="M20 12H4" />
          <path d="M10.5 5.5L4 12l6.5 6.5" />
        </>
      )}
      {name === 'arrow-right' && (
        <>
          <path d="M4 12h16" />
          <path d="M13.5 5.5L20 12l-6.5 6.5" />
        </>
      )}
      {name === 'stop' && <rect x="6" y="6" width="12" height="12" rx="1.6" />}
    </svg>
  );
}
