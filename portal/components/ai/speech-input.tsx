"use client"

import * as React from "react"
import { cn } from "cn"
import { Mic, Square } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Dictation for the composer, using the browser's own speech recognition.
 *
 * WHY NO RECORDING FALLBACK. The obvious second implementation records audio
 * and posts it to a transcription endpoint. This product has no such
 * endpoint, and shipping a control whose only path is a request that 404s
 * would be worse than not shipping it — so where the Web Speech API is
 * missing (Firefox), the control renders nothing at all rather than a button
 * that fails on press.
 *
 * WHY GHOST, NOT FILLED. The composer has exactly one filled control, Send
 * (see prompt-input.tsx). A filled mic sat beside it as a second primary
 * action, which is the specific failure that file exists to avoid. While
 * listening the control does take colour — that is state, not emphasis.
 *
 * WHY THE TRANSCRIPT IS APPENDED, NOT SUBMITTED. Recognition ends a phrase
 * whenever the speaker pauses. Sending on the first final result would fire a
 * turn every time the user drew breath.
 */
type Recognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: RecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

type RecognitionEvent = {
  resultIndex: number
  results: {
    length: number
    [index: number]: { isFinal: boolean; [index: number]: { transcript: string } }
  }
}

type RecognitionCtor = new () => Recognition

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function SpeechInput({
  onTranscript,
  lang,
  disabled,
  className,
}: {
  /** Receives each finished phrase. The caller decides where it lands. */
  onTranscript: (text: string) => void
  /** BCP-47 tag. Defaults to the user's own browser language. */
  lang?: string
  disabled?: boolean
  className?: string
}) {
  const [listening, setListening] = React.useState(false)
  const [supported, setSupported] = React.useState(false)
  const ref = React.useRef<Recognition | null>(null)
  const onTranscriptRef = React.useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  // Resolved in an effect, not during render: the constructor is a browser
  // global, and reading it while rendering would disagree with the markup
  // the server already sent.
  React.useEffect(() => {
    const Ctor = recognitionCtor()
    if (!Ctor) return
    setSupported(true)

    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = lang ?? navigator.language

    recognition.onresult = (event) => {
      let final = ""
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (result?.isFinal) final += result[0]?.transcript ?? ""
      }
      if (final) onTranscriptRef.current(final)
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)

    ref.current = recognition
    return () => {
      recognition.onresult = null
      recognition.onend = null
      recognition.onerror = null
      recognition.stop()
      ref.current = null
    }
  }, [lang])

  if (!supported) return null

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? "Stop dictating" : "Dictate a message"}
      title={listening ? "Stop dictating" : "Dictate a message"}
      onClick={() => {
        const recognition = ref.current
        if (!recognition) return
        if (listening) {
          recognition.stop()
          setListening(false)
          return
        }
        // `start()` throws if a previous session is still tearing down, which
        // is a no-op from the user's point of view, not an error to surface.
        try {
          recognition.start()
          setListening(true)
        } catch {
          setListening(false)
        }
      }}
      className={cn(
        // 36px, matching the send and attach targets either side of it: a
        // 28px mic sat in a row of 36px controls and read as a different
        // class of control rather than a peer.
        "size-9 rounded-full",
        listening
          ? "text-destructive hover:text-destructive"
          : "text-muted-foreground",
        className,
      )}
    >
      {listening ? (
        <Square className="size-3.5 fill-current" />
      ) : (
        <Mic className="size-4.5" />
      )}
    </Button>
  )
}
