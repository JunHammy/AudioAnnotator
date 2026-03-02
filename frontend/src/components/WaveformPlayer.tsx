"use client"

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { Box, HStack, IconButton, Text } from "@chakra-ui/react"
import {
  Pause,
  Play,
  SkipBack,
  Volume2,
  VolumeX,
} from "lucide-react"
import api from "@/lib/axios"

export interface WaveformPlayerRef {
  seekTo: (seconds: number) => void
  play: () => void
  pause: () => void
  getCurrentTime: () => number
}

interface Props {
  audioUrl: string
  onTimeUpdate?: (t: number) => void
  height?: number
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

const WaveformPlayer = forwardRef<WaveformPlayerRef, Props>(
  ({ audioUrl, onTimeUpdate, height = 80 }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const wsRef = useRef<any>(null)
    const [playing, setPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [ready, setReady] = useState(false)
    const [muted, setMuted] = useState(false)

    useEffect(() => {
      if (!containerRef.current) return
      let ws: any
      let blobUrl: string | null = null

      const init = async () => {
        const WaveSurfer = (await import("wavesurfer.js")).default

        ws = WaveSurfer.create({
          container: containerRef.current!,
          waveColor: "#4a5568",
          progressColor: "#3b82f6",
          cursorColor: "#ef4444",
          cursorWidth: 2,
          height,
          normalize: true,
          interact: true,
        })

        wsRef.current = ws

        // Fetch audio through the axios instance so the JWT header is included.
        // WaveSurfer's own fetch() call would not carry the Authorization header.
        try {
          const response = await api.get(audioUrl, { responseType: "blob" })
          blobUrl = URL.createObjectURL(response.data)
          ws.load(blobUrl)
        } catch {
          // Surface loading errors as a ready=false state — parent will show skeleton
          return
        }

        ws.on("ready", () => {
          setDuration(ws.getDuration())
          setReady(true)
        })

        ws.on("audioprocess", (t: number) => {
          setCurrentTime(t)
          onTimeUpdate?.(t)
        })

        // v7 uses 'interaction' for seek clicks
        ws.on("interaction", () => {
          const t = ws.getCurrentTime()
          setCurrentTime(t)
          onTimeUpdate?.(t)
        })

        ws.on("play", () => setPlaying(true))
        ws.on("pause", () => setPlaying(false))
        ws.on("finish", () => {
          setPlaying(false)
          setCurrentTime(0)
        })
      }

      init()

      return () => {
        ws?.destroy()
        wsRef.current = null
        if (blobUrl) URL.revokeObjectURL(blobUrl)
      }
    }, [audioUrl]) // eslint-disable-line react-hooks/exhaustive-deps

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        if (wsRef.current && duration > 0) {
          wsRef.current.setTime(seconds)
          setCurrentTime(seconds)
          onTimeUpdate?.(seconds)
        }
      },
      play: () => wsRef.current?.play(),
      pause: () => wsRef.current?.pause(),
      getCurrentTime: () => wsRef.current?.getCurrentTime() ?? 0,
    }))

    const togglePlay = useCallback(() => wsRef.current?.playPause(), [])

    const skipToStart = useCallback(() => {
      if (wsRef.current) {
        wsRef.current.setTime(0)
        setCurrentTime(0)
        onTimeUpdate?.(0)
      }
    }, [onTimeUpdate])

    const toggleMute = useCallback(() => {
      if (wsRef.current) {
        const next = !muted
        wsRef.current.setMuted(next)
        setMuted(next)
      }
    }, [muted])

    return (
      <Box>
        <Box
          ref={containerRef}
          w="full"
          bg="bg.subtle"
          rounded="md"
          overflow="hidden"
          minH={`${height}px`}
          borderWidth="1px"
          borderColor="border"
          opacity={ready ? 1 : 0.5}
        />
        <HStack mt={2} justify="space-between" px={1}>
          <HStack gap={1}>
            <IconButton
              aria-label="Skip to start"
              size="sm"
              variant="ghost"
              onClick={skipToStart}
              disabled={!ready}
            >
              <SkipBack size={16} />
            </IconButton>
            <IconButton
              aria-label={playing ? "Pause" : "Play"}
              size="sm"
              variant={playing ? "solid" : "outline"}
              colorPalette="blue"
              onClick={togglePlay}
              disabled={!ready}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </IconButton>
            <IconButton
              aria-label={muted ? "Unmute" : "Mute"}
              size="sm"
              variant="ghost"
              onClick={toggleMute}
              disabled={!ready}
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </IconButton>
          </HStack>
          <Text fontSize="sm" color="fg.muted" fontFamily="mono">
            {fmtTime(currentTime)}
            {" / "}
            {fmtTime(duration)}
          </Text>
        </HStack>
      </Box>
    )
  }
)

WaveformPlayer.displayName = "WaveformPlayer"
export default WaveformPlayer
