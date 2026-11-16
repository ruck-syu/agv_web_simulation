# Warehouse control desk redesign

## Design plan

The operator's job is to see the physical warehouse, drive the selected AGV, and dispatch a destination. The warehouse simulation is the primary visual; the surrounding interface is a control desk.

Palette: concrete `#edf0f2`, paper `#ffffff`, ink `#243847`, steel `#617581`, control blue `#245b7d`, stop red `#b23b36`. Use muted secondary states, with color backed by text.

Type: self-hosted Barlow for controls and readable labels; Barlow Condensed semibold for station and section titles. Numeric readings use tabular figures in the same family. Sentence case, no tracked uppercase eyebrows.

Layout: a compact station header above a large warehouse view with a physical telemetry strip; a white control console on the right holds manual drive, destination, map and inspection tools. Everything aligns to the left except centered directional keys. Diagnostics remain a native disclosure below operational tools. At narrow sizes the viewport and console stack in DOM order.

```
Warehouse control     Warehouse 01       Robot status / full screen
+--------------------------------------+--------------------------+
| Warehouse floor     Camera controls  | AGV-07                   |
|                                      | Drive AGV                |
|              Live 3D scene           | Direction pad / speeds   |
|                                      | Controller               |
|                                      | Autonomous navigation    |
|                                      | Map / inspection         |
+--------------------------------------+--------------------------+
| Motion / speed / position / clearance| Diagnostics (collapsed)  |
+--------------------------------------+--------------------------+
```

Principles: actual operational data instead of invented metrics; structural section divisions instead of a stack of floating cards; red is an action/fault signal; the real orange warehouse racks supply the visual character. No decorative gradients, pulsing indicators, fake navigation, oversized marketing headings or phase information.

## Review before implementation

A dark industrial HMI would repeat the current near-black/amber treatment and the usual generated-dashboard vocabulary. Revised to a light, cool control desk that gives the warehouse its own visual weight. An icon navigation rail was rejected because there are no meaningful separate destinations to justify it. Typography and the contrast between the physical scene and quiet instrument console carry the identity; surrounding decoration is removed.

## Visual critique

Desktop and 390 px mobile screenshots confirmed the light console hierarchy and intact scene. Removed a third-row mobile camera toolbar: focus/reset remain in Camera & overlays and full screen remains in the header. Rounded floating-point sensor values for presentation only; scan ranges, map resolution and control values retain their original data internally. Shortened inspection copy that described implementation rather than operator decisions.

## Validation

Production TypeScript/Vite build passes. All 20 frontend tests pass. Both Chrome end-to-end tests pass: virtual controller safety behavior and live ROS map/navigation/reconnect behavior. The live browser test waits for self-hosted fonts before interacting with the redesigned layout. Desktop and 390 px mobile screenshots were inspected, with no horizontal document overflow or phase text. The same TryCloudflare preview is rebuilt with its secure ROS WebSocket endpoint. Barlow font license notices are shipped with the preview.
