# Agora Rotary Dial Phone

An interactive 1930s rotary telephone rendered in Three.js. Lift the receiver,
rotate a digit clockwise until its finger hole reaches the metal stop, and
release it to register the number during the spring return.

The experience is designed as a foundation for an Agora Conversational AI voice
call.

## Development

```bash
pnpm install
pnpm dev
```

## Production build

```bash
pnpm test:physics
pnpm typecheck
pnpm build
```
