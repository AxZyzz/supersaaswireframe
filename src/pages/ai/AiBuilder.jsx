import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Send, ArrowRight, BookOpen, Globe, Pencil } from 'lucide-react'
import { Avatar, Drawer, Button, Tag, cx } from '../../components/ui.jsx'
import { businessMemory } from '../../data/mock2.js'

// Scripted back-and-forth. Each "turn" = an assistant prompt, optional quick
// chips, and the canned user reply revealed when the reviewer advances.
const SCRIPT = [
  {
    assistant: "Hi Yakin! I'll help you build a campaign. First — what does your business do, and what are you offering?",
    chips: [],
    user: 'We run a local business directory. We help service businesses get more clients.',
    stepLabel: 'Business context',
  },
  {
    assistant: 'Great. Who should this campaign target?',
    chips: ["Use 'Hot Leads' segment", 'Dentists', 'All new leads'],
    user: 'Target the Hot Leads segment — mostly clinics and law firms.',
    stepLabel: 'Audience',
  },
  {
    assistant: "What's the main goal of this campaign?",
    chips: ['Book a call', 'Get a reply', 'Promote an offer'],
    user: 'Book a call.',
    stepLabel: 'Goal',
  },
  {
    assistant: 'What tone should I use?',
    chips: ['Friendly', 'Professional', 'Direct'],
    user: 'Professional but warm.',
    stepLabel: 'Tone',
  },
  {
    assistant: 'Any constraints? (send limits, follow-ups, things to avoid)',
    chips: [],
    user: 'Max 3 emails, no pushy language.',
    stepLabel: 'Constraints',
  },
]

export default function AiBuilder() {
  const navigate = useNavigate()
  // turn = how many scripted prompts have been shown; answered = user replies given
  const [answered, setAnswered] = useState(0)
  const [thinking, setThinking] = useState(false)
  const [done, setDone] = useState(false)
  const scrollRef = useRef(null)
  const [input, setInput] = useState('')
  const [memOpen, setMemOpen] = useState(false)

  const totalSteps = SCRIPT.length
  const current = SCRIPT[answered]

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [answered, thinking, done])

  const advance = () => {
    const next = answered + 1
    setInput('')
    if (next >= totalSteps) {
      // last answer given → show thinking, then final message
      setAnswered(next)
      setThinking(true)
      setTimeout(() => {
        setThinking(false)
        setDone(true)
      }, 1400)
    } else {
      setAnswered(next)
    }
  }

  // Build the visible message list
  const messages = []
  for (let i = 0; i <= answered && i < totalSteps; i++) {
    messages.push({ who: 'assistant', text: SCRIPT[i].assistant })
    if (i < answered) messages.push({ who: 'user', text: SCRIPT[i].user })
  }

  return (
    <div className="flex h-full flex-col bg-page">
      {/* Header */}
      <div className="border-b border-line bg-white px-6 py-3">
        <div className="mx-auto flex max-w-[760px] items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
              <Sparkles size={17} strokeWidth={1.9} />
            </span>
            <div>
              <div className="text-sm font-semibold text-ink">AI Campaign Assistant</div>
              <div className="text-tiny text-muted">
                Step {Math.min(answered + 1, totalSteps)} of {totalSteps}: {(current || SCRIPT[totalSteps - 1]).stepLabel}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setMemOpen(true)} className="flex items-center gap-1.5 rounded border border-line-mid bg-white px-2.5 py-1.5 text-tiny text-accent hover:bg-accent-soft">
              <BookOpen size={13} /> Using memory · View
            </button>
            <button onClick={() => navigate('/campaigns/new/setup')} className="text-tiny text-muted hover:text-ink">
              Switch to manual builder
            </button>
          </div>
        </div>
        {/* progress hint */}
        <div className="mx-auto mt-2.5 flex max-w-[760px] gap-1">
          {SCRIPT.map((_, i) => (
            <span
              key={i}
              className={cx('h-1 flex-1 rounded-full', i < answered || done ? 'bg-accent' : i === answered ? 'bg-accent-soft2' : 'bg-line')}
            />
          ))}
        </div>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] space-y-4 px-6 py-6">
          {messages.map((m, i) =>
            m.who === 'assistant' ? (
              <div key={i} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <Sparkles size={15} strokeWidth={1.9} />
                </span>
                <div className="max-w-[80%] rounded-lg rounded-tl-sm border border-line bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink">
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} className="flex items-start justify-end gap-2.5">
                <div className="max-w-[80%] rounded-lg rounded-tr-sm bg-accent-soft px-3.5 py-2.5 text-sm leading-relaxed text-ink">
                  {m.text}
                </div>
                <Avatar name="Yakin Shah" size={32} tint={{ bg: '#DCE3FB', text: '#3651B8' }} />
              </div>
            ),
          )}

          {thinking && (
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Sparkles size={15} strokeWidth={1.9} />
              </span>
              <div className="rounded-lg rounded-tl-sm border border-line bg-white px-4 py-3">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint" />
                </span>
              </div>
            </div>
          )}

          {done && (
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                <Sparkles size={15} strokeWidth={1.9} />
              </span>
              <div className="max-w-[80%] rounded-lg rounded-tl-sm border border-line bg-white px-3.5 py-3">
                <p className="text-sm leading-relaxed text-ink">
                  Perfect — I have what I need. I've drafted a 3-email sequence for your Hot Leads, aimed at booking calls,
                  in a professional but warm tone.
                </p>
                <button
                  onClick={() => navigate('/campaigns/new/ai/summary')}
                  className="mt-3 inline-flex h-9 items-center gap-1.5 rounded bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover"
                >
                  <Sparkles size={15} /> Generate campaign <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      {!done && !thinking && (
        <div className="border-t border-line bg-white px-6 py-3">
          <div className="mx-auto max-w-[760px]">
            {current?.chips?.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {current.chips.map((c) => (
                  <button
                    key={c}
                    onClick={advance}
                    className="rounded-full border border-line-mid bg-white px-3 py-1.5 text-tiny text-ink hover:bg-accent-soft hover:text-accent"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && advance()}
                placeholder={current ? 'Type your answer…' : ''}
                className="h-10 flex-1 rounded-lg border border-line-mid bg-white px-3.5 text-sm text-ink placeholder:text-faint focus-ring"
              />
              <button
                onClick={advance}
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-white hover:bg-accent-hover"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {memOpen && (
        <Drawer
          title="Business memory"
          onClose={() => setMemOpen(false)}
          width="max-w-sm"
          footer={<Button variant="secondary" icon={Pencil} onClick={() => navigate('/settings?tab=ai-memory')}>Edit memory</Button>}
        >
          <p className="mb-3 text-tiny text-muted">The assistant is drafting from this saved context.</p>
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-tiny text-muted">Business</div>
              <p className="text-ink">{businessMemory.description}</p>
            </div>
            <div className="border-t border-line pt-3">
              <div className="text-tiny text-muted">Offer</div>
              <p className="text-ink">{businessMemory.offer}</p>
            </div>
            <div className="border-t border-line pt-3">
              <div className="text-tiny text-muted">Booking link</div>
              <p className="font-mono text-tiny text-ink">{businessMemory.bookingLink}</p>
            </div>
            <div className="border-t border-line pt-3">
              <div className="text-tiny text-muted">Tone</div>
              <Tag tone="info" className="mt-1">{businessMemory.tone}</Tag>
            </div>
            <div className="border-t border-line pt-3">
              <div className="mb-1 text-tiny text-muted">Website URLs used by AI</div>
              <div className="space-y-1">
                {businessMemory.urls.filter((u) => u.usedByAI).map((u) => (
                  <div key={u.url} className="flex items-center gap-1.5 text-tiny text-ink"><Globe size={12} className="text-faint" /> {u.url}</div>
                ))}
              </div>
            </div>
          </div>
        </Drawer>
      )}
    </div>
  )
}
