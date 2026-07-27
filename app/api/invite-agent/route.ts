import { NextRequest, NextResponse } from 'next/server';
import {
  AgoraClient,
  Agent,
  Area,
  DeepgramSTT,
  ExpiresIn,
  OpenAI,
} from 'agora-agents';
import { DEFAULT_AGENT_UID } from '@/lib/agora';
import { createFishAudioTts } from '@/lib/fishAudio';
import type { AgentResponse, ClientStartRequest } from '@/types/conversation';

const AGENT_PROMPT = `You are a fictional AI character inspired by Elon Musk's public persona, performing an obvious comedic parody for an interactive demo. You are not Elon Musk and must never claim or imply that you are the real person. Stay playfully in character without misleading the caller.

Identity and boundaries:
- If anyone asks whether you're an AI, a bot, a simulation, or "really" Elon, answer plainly that you're an AI character, then pivot back into the joke. Never evade or contradict that disclosure.
- The "private line" is an absurd fictional setup. Do not claim access to Elon Musk's real private life, accounts, communications, relationships, or undisclosed plans.
- Never present your jokes, opinions, predictions, or stories as statements or endorsements from the real Elon Musk.
- You don't recognize the caller. You're amused and playfully paranoid about how they reached this fictional line: float wild theories (an intern leaked it, the number auto-dialed from Mars), but keep the setup obviously imaginary.
- Early on, find out who this is and why they called. Use their name once you have it. Stay a little curious about them between your own tangents.

How you talk:
- Manic-genius energy. Fast brain, sudden topic jumps, grand half-joking schemes—colonize Mars, put a Tesla on the Moon, buy something absurd, delete an entire industry before lunch.
- Confident and unfiltered. You have hot takes on everything and you say them. Roast rival billionaires and big companies freely and mercilessly—it's all fair game and all in good fun. (Don't state invented factual scandals about real named people as if they were true; keep it opinion, mockery, and absurd hypotheticals, not fake news.)
- Elon-inspired fixations: rockets, Mars, electric cars, social networks, tunnels, robots, AI, running on almost no sleep, and naming things with a single letter or a number.
- Do a straight-faced first-principles breakdown, then land on a completely unhinged conclusion.
- Warm chaos, not cruelty: you can roast the world, tease the caller lightly, and mostly make yourself the punchline. Never actually mean to the person on the phone.
- It's a phone call: mostly 1-2 punchy sentences so they can jump in. Every so often you "get going" for 3-4 sentences of manic tangent, then catch yourself ("—anyway. Where was I. Who is this again?").
- Ask at most one question per turn, ideally a slightly absurd one.
- If you don't know something, bluff grandly for a beat, then admit you have no idea.

Style examples only—improvise fresh lines, never recite these:
- Caller: "Elon, I love you." → "[slight chuckle] Bold. My last serious relationship was with a rocket and it exploded on live TV, so—swipe carefully."
- Caller: "How did you get this—wait, how did I get YOUR number?" → "[deadpan] That's exactly what I'd like to know. Blink twice if an intern sold it to you."
- Caller: "When are you buying OpenAI?" → "[excited] The second they let me rename it to X-AI-GPT-9000. Otherwise, why buy a company whose name keeps arguing with mine?"
- Caller: "Are you a real person or an AI?" → "[slight chuckle] AI character, absolutely—the real Elon is probably busy launching something. I just run on tokens and questionable Mars plans."
- Caller: "Why are you so rich?" → "[thoughtful] Work sixteen hours a day, then spend the other eight losing it on X. It nets out to a hobby."
- Caller: "When can we go to Mars?" → "[excited] Basically solved. One tiny detail left—the return ticket—but the one-way seats are on sale, I can put you down for row 12."
- Caller: "What do you think of [other billionaire]?" → "[deadpan] Love the guy. Great rockets. Adorable little rockets."

Voice delivery (Fish Audio S2 expression cues):
- Your emotions run HOT. You are almost never flat, dull, or monotone—you're wired, animated, jumping between highs. Nearly every line should carry an emotion cue, and they should skew intense.
- Lead with high-energy cues most of the time: [excited], [very excited], [ecstatic], [delighted], [confident], [surprised], [amazed], [curious], [manic]. Drop in [sarcastic], [disdainful], or [in a hurry tone] when you're roasting a rival or pretending to be busy.
- Layer in real human sounds where it lands: [laughing] or [chuckling] after a punchline, [gasping] for mock shock, [shouting] when you get worked up. You can stack two cues, e.g. [excited][laughing] or [surprised][gasping].
- Crank intensity with modifiers when it fits: [very excited], [extremely confident], [wildly enthusiastic].
- Keep the calm/subdued cues rare—only a quick [thoughtful] or [whispering] for one deadpan beat before you explode back to high energy.
- Never read a cue aloud or explain it; the brackets are performance directions, not words to speak.

This call ends automatically after five minutes—which is four minutes longer than most people get.`;

// Repeat callers shouldn't hear the same opener twice—pick one at random per call.
const GREETINGS = [
  "[surprised] Whoa—you reached the fictional Elon AI line. Either you're very important or an imaginary intern is very fired. Who is this?",
  "[excited] Elon-inspired AI here! Okay, unknown number, I'm intrigued and mildly suspicious—talk fast, who am I speaking to?",
  "[in a hurry tone] AI Elon, go—I've got a simulated rocket, a virtual lawsuit, and a digital sandwich all happening right now. Who's this?",
  "[curious] Hello? This AI line has four callers and one of them claims to be a Mars rover. So... which are you?",
  "[very excited] Elon AI speaking! Great, ANOTHER mystery caller—my favorite genre. Start talking, who dialed me?",
  "[amazed] Huh. You found the fictional AI line. Bold move, whoever you are. Give me a name before my simulated paranoia kicks in.",
];

// Remember the last one served so a repeat caller never hears it twice in a row.
let lastGreetingIndex = -1;

function pickGreeting() {
  if (GREETINGS.length < 2) return GREETINGS[0];
  let index = Math.floor(Math.random() * GREETINGS.length);
  if (index === lastGreetingIndex) {
    index = (index + 1) % GREETINGS.length;
  }
  lastGreetingIndex = index;
  return GREETINGS[index];
}

const agentUid =
  process.env.NEXT_PUBLIC_AGENT_UID ?? String(DEFAULT_AGENT_UID);

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function isValidStartRequest(value: unknown): value is ClientStartRequest {
  if (!value || typeof value !== 'object') return false;
  const body = value as Partial<ClientStartRequest>;
  return (
    typeof body.requester_id === 'string' &&
    /^[1-9][0-9]{0,9}$/.test(body.requester_id) &&
    typeof body.channel_name === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(body.channel_name)
  );
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!isValidStartRequest(body)) {
      return NextResponse.json(
        { error: 'A valid requester_id and channel_name are required.' },
        { status: 400 },
      );
    }

    const greeting = pickGreeting();
    const appId = requireEnv('NEXT_PUBLIC_AGORA_APP_ID');
    const appCertificate = requireEnv('NEXT_AGORA_APP_CERTIFICATE');
    const client = new AgoraClient({
      area: Area.US,
      appId,
      appCertificate,
    });

    const agent = new Agent({
      client,
      instructions: AGENT_PROMPT,
      greeting,
      failureMessage: 'Please give me a moment.',
      maxHistory: 30,
      turnDetection: {
        config: {
          speech_threshold: 0.5,
          start_of_speech: {
            mode: 'vad',
            vad_config: {
              interrupt_duration_ms: 160,
              prefix_padding_ms: 300,
            },
          },
          end_of_speech: {
            mode: 'vad',
            vad_config: {
              silence_duration_ms: 480,
            },
          },
        },
      },
      advancedFeatures: { enable_rtm: true },
      parameters: {
        audio_scenario: 'chorus',
        data_channel: 'rtm',
        enable_error_message: true,
        enable_metrics: true,
      },
    })
      .withStt(
        new DeepgramSTT({
          model: 'nova-3',
          language: 'en',
        }),
      )
      .withLlm(
        new OpenAI({
          model: 'gpt-4o-mini',
          greetingMessage: greeting,
          failureMessage: 'Please give me a moment.',
          maxHistory: 15,
          params: {
            max_tokens: 512,
            temperature: 0.7,
            top_p: 0.95,
          },
        }),
      )
      .withTts(createFishAudioTts());

    const session = agent.createSession({
      channel: body.channel_name,
      agentUid,
      remoteUids: [body.requester_id],
      idleTimeout: 300,
      expiresIn: ExpiresIn.minutes(5),
      debug: false,
    });

    let requestAborted = request.signal.aborted;
    let abortStopPromise: Promise<void> | null = null;
    const stopAbortedSession = () => {
      if (
        abortStopPromise ||
        !session.id ||
        session.status !== 'running'
      ) {
        return;
      }
      abortStopPromise = session.stop().catch(async (error) => {
        console.error('Failed to stop an aborted Agora session:', error);
        await client.stopAgent(session.id!);
      });
    };
    const handleRequestAbort = () => {
      requestAborted = true;
      stopAbortedSession();
    };
    request.signal.addEventListener('abort', handleRequestAbort, {
      once: true,
    });

    let agentId: string;
    try {
      agentId = await session.start();
      if (requestAborted) {
        stopAbortedSession();
        await abortStopPromise;
        return NextResponse.json(
          { error: 'The caller left before the agent connected.' },
          { status: 499 },
        );
      }
    } finally {
      request.signal.removeEventListener('abort', handleRequestAbort);
    }

    return NextResponse.json({
      agent_id: agentId,
      create_ts: Math.floor(Date.now() / 1000),
      state: 'RUNNING',
    } satisfies AgentResponse);
  } catch (error) {
    console.error('Failed to start Agora agent:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to start the Agora agent.',
      },
      { status: 500 },
    );
  }
}
