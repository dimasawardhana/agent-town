# Rendering architecture: Phaser.CANVAS + React DOM overlay

## Context

AI Town requires a 2D game world (Phaser) and a UI layer (React). The two rendering engines must coexist without conflicts over camera, input, and state.

## Decision

Use Phaser.CANVAS renderer for the game world with React DOM overlay for UI panels. Zustand shared state layer connects both engines. Phaser owns the camera. React overlays use CSS positioning.

## Why

Research validated three proven patterns:

1. **Zustand shared state** (the-11th-forest, production): Phaser `scene.update()` calls `useGameStore.getState().setX()` while React HUDs subscribe via `useGameStore(selector)`. This is the cleanest pattern for AI Town because Zustand is already in the tech stack.
2. **EventEmitter bridge** (phaser-react-tools): Game events emitted via `game.events.emit()` listened to by React via `useEventEmitter`. Useful for discrete actions but adds complexity for continuous state sync.
3. **PhaserJSX** (@number10): React-like JSX components rendered into Phaser scenes. More abstract but less mature ecosystem.

Pattern 1 (Zustand) was chosen because:
- Zustand is already in the proposed tech stack (Section 21)
- It requires zero additional dependencies
- The 11th Forest project proves it works in production with Phaser 4 + React 19
- It provides the simplest bidirectional sync between game loop and React UI

## Consequences

- Must use `Phaser.CANVAS` renderer (not WebGL) when React DOM overlays are present
- Phaser's `CameraManager` owns all camera operations (pan, zoom, follow)
- React HUDs use CSS `position: absolute` with `transform: scale()` for viewport-relative positioning
- State changes in Phaser update the Zustand store; React components react to store changes
- This means Phaser writes to store, React reads from store — one-way data flow from game to UI
- Input events for UI (clicks on building details panel) flow through React; input for game (click on building in canvas) flows through Phaser

## Key Constraint

The game world and UI must not fight for the same pixels. Phaser renders the canvas. React renders overlays on top. The boundary is clear: game = canvas, UI = DOM overlay.
