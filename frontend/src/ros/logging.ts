import type { RosLogEntry, RosLogLevel } from '../types/ros';

let localLogSequence = 0;

export function createRosLogEntry(
  level: RosLogLevel,
  source: string,
  message: string,
): RosLogEntry {
  localLogSequence += 1;
  return {
    id: `${Date.now()}-${localLogSequence}`,
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
  };
}

export function formatLogTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleTimeString('en-GB', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatMessageTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleTimeString('en-GB', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
