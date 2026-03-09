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
  addRegion: (id: string, start: number, end: number, color?: string) => void
  clearRegions: () => void
}

interface Props {
  audioUrl: string
  onTimeUpdate?: (t: number) => void
  onRegionUpdate?: (id: string, start: number, end: number) => void
  onReady?: () => void
  height?: number
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

const WaveformPlayer = forwardRef<WaveformPlayerRef, Props>(
  ({ audioUrl, onTimeUpdate, onRegionUpdate, onReady, height = 80 }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const wsRef = useRef<any>(null)
    const regionsRef = useRef<any>(null)
    const [playing, setPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [ready, setReady] = useState(false)
    const [muted, setMuted] = useState(false)

    useEffect(() => {
      if (!containerRef.current) return
      let ws: any
      let blobUrl: string | null = null
      // Prevents the async init from completing after React StrictMode's
      // first-pass cleanup fires — which would leave a zombie WaveSurfer instance
      // appended to the container and result in two visible waveforms.
      let cancelled = false

      const init = async () => {
        const WaveSurfer = (await import("wavesurfer.js")).default
        const RegionsPlugin = (await import("wavesurfer.js/dist/plugins/regions.esm.js")).default

        // If cleanup already ran (StrictMode double-invoke), bail out early.
        if (cancelled || !containerRef.current) return

        const regions = RegionsPlugin.create()

        ws = WaveSurfer.create({
          container: containerRef.current,
          waveColor: "#4a5568",
          progressColor: "#3b82f6",
          cursorColor: "#ef4444",
          cursorWidth: 2,
          height,
          normalize: true,
          interact: true,
          plugins: [regions],
        })

        wsRef.current = ws
        regionsRef.current = regions

        // Fetch audio through axios so the JWT Authorization header is included.
        // WaveSurfer's own internal fetch() would not carry the auth header.
        try {
          const response = await api.get(audioUrl, { responseType: "blob" })
          if (cancelled) {
            ws.destroy()
            return
          }
          blobUrl = URL.createObjectURL(response.data)
          ws.load(blobUrl)
        } catch {
          return
        }

        ws.on("ready", () => {
          setDuration(ws.getDuration())
          setReady(true)
          onReady?.()
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

        // Region drag/resize events
        regions.on("region-updated", (region: any) => {
          onRegionUpdate?.(region.id, region.start, region.end)
        })
      }

      init()

      return () => {
        cancelled = true
        ws?.destroy()
        wsRef.current = null
        regionsRef.current = null
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
      addRegion: (id: string, start: number, end: number, color = "rgba(59,130,246,0.25)") => {
        regionsRef.current?.addRegion({ id, start, end, color, drag: true, resize: true })
      },
      clearRegions: () => {
        regionsRef.current?.clearRegions()
      },
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
