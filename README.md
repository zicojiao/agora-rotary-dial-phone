# Agora Rotary Dial Phone

An interactive 1930s rotary telephone rendered in Three.js and connected to
Agora Conversational AI. Lift the receiver and physically dial `5550193` to
start a disclosed, fictional Elon-inspired AI conversation.

Each digit registers only after the finger hole reaches the metal stop and the
dial returns. The AI call starts its visible five-minute countdown only after
the Agora agent joins the RTC channel. Manual hang-up and timeout use the same
agent, RTC, RTM, microphone, receiver, and dial cleanup path.

## Environment

Create `.env.local` with server-managed Agora project credentials:

```dotenv
NEXT_PUBLIC_AGORA_APP_ID=
NEXT_AGORA_APP_CERTIFICATE=
NEXT_PUBLIC_AGENT_UID=123456
```

The App Certificate must never be exposed to client code or committed.

## Development

```bash
pnpm install
pnpm dev
```

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
