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
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import api from "@/lib/axios"

export interface WaveformPlayerRef {
  seekTo: (seconds: number) => void
  play: () => void
  pause: () => void
  playPause: () => void
  getCurrentTime: () => number
  addRegion: (id: string, start: number, end: number, color?: string) => void
  clearRegions: () => void
  activateRegion: (id: string) => void
  deactivateRegion: (id: string) => void
}

interface Props {
  audioUrl: string
  onTimeUpdate?: (t: number) => void
  onRegionUpdate?: (id: string, start: number, end: number) => void
  onRangeSelect?: (start: number, end: number) => void
  onReady?: (duration: number) => void
  height?: number
}

const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
const ZOOM_MIN = 50
const ZOOM_MAX = 400
const ZOOM_STEP = 50

function fmtTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

const WaveformPlayer = forwardRef<WaveformPlayerRef, Props>(
  ({ audioUrl, onTimeUpdate, onRegionUpdate, onRangeSelect, onReady, height = 80 }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const wsRef = useRef<any>(null)
    const regionsRef = useRef<any>(null)
    const regionMapRef = useRef<Map<string, { region: any; color: string }>>(new Map())
    const onRegionUpdateRef = useRef(onRegionUpdate)
    const onRangeSelectRef = useRef(onRangeSelect)
    const addingProgrammatically = useRef(false)
    const [playing, setPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [ready, setReady] = useState(false)
    const [muted, setMuted] = useState(false)
    const [speed, setSpeedState] = useState(1)
    const [zoom, setZoomState] = useState(ZOOM_MIN)

    useEffect(() => { onRegionUpdateRef.current = onRegionUpdate }, [onRegionUpdate])
    useEffect(() => { onRangeSelectRef.current = onRangeSelect }, [onRangeSelect])

    useEffect(() => {
      if (!containerRef.current) return
      let ws: any
      let blobUrl: string | null = null
      let cancelled = false

      const init = async () => {
        const WaveSurfer = (await import("wavesurfer.js")).default
        const RegionsPlugin = (await import("wavesurfer.js/dist/plugins/regions.esm.js")).default

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
          minPxPerSec: ZOOM_MIN,
          plugins: [regions],
        })

        wsRef.current = ws
        regionsRef.current = regions

        try {
          const response = await api.get(audioUrl, { responseType: "blob" })
          if (cancelled) { ws.destroy(); return }
          blobUrl = URL.createObjectURL(response.data)
          ws.load(blobUrl)
        } catch {
          return
        }

        ws.on("ready", () => {
          const dur = ws.getDuration()
          setDuration(dur)
          setReady(true)
          onReady?.(dur)
        })

        ws.on("audioprocess", (t: number) => {
          setCurrentTime(t)
          onTimeUpdate?.(t)
        })

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

        regions.on("region-updated", (region: any) => {
          onRegionUpdateRef.current?.(region.id, region.start, region.end)
        })

        // Drag on empty waveform space to select a time range.
        // Guard: region-created fires for both drag and addRegion() calls —
        // skip it when we're adding programmatically.
        regions.enableDragSelection({ color: "rgba(59,130,246,0.15)" })
        regions.on("region-created", (region: any) => {
          if (addingProgrammatically.current) return
          if (onRangeSelectRef.current) {
            onRangeSelectRef.current(region.start, region.end)
          }
          region.remove()
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
      playPause: () => wsRef.current?.playPause(),
      getCurrentTime: () => wsRef.current?.getCurrentTime() ?? 0,
      addRegion: (id: string, start: number, end: number, color = "rgba(59,130,246,0.25)") => {
        addingProgrammatically.current = true
        const r = regionsRef.current?.addRegion({ id, start, end, color, drag: false, resize: false })
        if (r) regionMapRef.current.set(id, { region: r, color })
        addingProgrammatically.current = false
      },
      clearRegions: () => {
        regionsRef.current?.clearRegions()
        regionMapRef.current.clear()
      },
      activateRegion: (id: string) => {
        const entry = regionMapRef.current.get(id)
        // Cyan — distinct from all speaker colours (blue/green/amber/red/purple)
        if (entry) entry.region.setOptions({ drag: true, resize: true, color: "rgba(6,182,212,0.6)" })
      },
      deactivateRegion: (id: string) => {
        const entry = regionMapRef.current.get(id)
        if (entry) entry.region.setOptions({ drag: false, resize: false, color: entry.color })
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

    const changeSpeed = useCallback((next: number) => {
      wsRef.current?.setPlaybackRate(next)
      setSpeedState(next)
    }, [])

    const changeZoom = useCallback((delta: number) => {
      setZoomState(prev => {
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev + delta))
        wsRef.current?.zoom(next)
        return next
      })
    }, [])

    return (
      <Box>
        {/* Waveform container — scrollable when zoomed in */}
        <Box
          ref={containerRef}
          w="full"
          bg="bg.subtle"
          rounded="md"
          overflow="auto"
          minH={`${height}px`}
          borderWidth="1px"
          borderColor="border"
          opacity={ready ? 1 : 0.5}
          css={{
            "&::-webkit-scrollbar": { height: "4px" },
            "&::-webkit-scrollbar-track": { background: "transparent" },
            "&::-webkit-scrollbar-thumb": { background: "#4a4c54", borderRadius: "999px" },
          }}
        />

        {/* Controls row */}
        <HStack mt={2} justify="space-between" px={1} flexWrap="wrap" gap={1}>
          {/* Transport + mute */}
          <HStack gap={1}>
            <IconButton aria-label="Skip to start" size="sm" variant="ghost" onClick={skipToStart} disabled={!ready}>
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
            <IconButton aria-label={muted ? "Unmute" : "Mute"} size="sm" variant="ghost" onClick={toggleMute} disabled={!ready}>
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </IconButton>
          </HStack>

          {/* Speed buttons */}
          <HStack gap={0.5}>
            {SPEED_STEPS.map(s => (
              <Box
                key={s}
                as="button"
                px="6px"
                py="2px"
                fontSize="10px"
                rounded="sm"
                borderWidth="1px"
                borderColor={speed === s ? "blue.400" : "border"}
                bg={speed === s ? "blue.900" : "transparent"}
                color={speed === s ? "blue.300" : "fg.muted"}
                cursor={ready ? "pointer" : "not-allowed"}
                opacity={ready ? 1 : 0.4}
                onClick={() => ready && changeSpeed(s)}
                title={`${s}× speed`}
              >
                {s}×
              </Box>
            ))}
          </HStack>

          {/* Zoom controls + time */}
          <HStack gap={1}>
            <IconButton
              aria-label="Zoom out"
              size="xs"
              variant="ghost"
              disabled={!ready || zoom <= ZOOM_MIN}
              onClick={() => changeZoom(-ZOOM_STEP)}
              title="Zoom out"
            >
              <ZoomOut size={14} />
            </IconButton>
            <Text fontSize="10px" color="fg.muted" w="40px" textAlign="center" userSelect="none">
              {zoom}px
            </Text>
            <IconButton
              aria-label="Zoom in"
              size="xs"
              variant="ghost"
              disabled={!ready || zoom >= ZOOM_MAX}
              onClick={() => changeZoom(ZOOM_STEP)}
              title="Zoom in"
            >
              <ZoomIn size={14} />
            </IconButton>
            <Text fontSize="sm" color="fg.muted" fontFamily="mono" ml={2}>
              {fmtTime(currentTime)} / {fmtTime(duration)}
            </Text>
          </HStack>
        </HStack>
      </Box>
    )
  }
)

WaveformPlayer.displayName = "WaveformPlayer"
export default WaveformPlayer
