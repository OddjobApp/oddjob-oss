"use client"

import * as React from "react"
import { Play, Pause, Volume2, Maximize, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from './button.js'
import { Slider } from './slider.js'

interface VideoPlayerProps {
  src: string
  poster?: string
  title?: string
  className?: string
  autoPlay?: boolean
  muted?: boolean
}

export function VideoPlayer({
  src,
  poster,
  title,
  className,
  autoPlay = false,
  muted = false,
}: VideoPlayerProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [volume, setVolume] = React.useState(100)
  const [isMuted, setIsMuted] = React.useState(muted)

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const current = (videoRef.current.currentTime / videoRef.current.duration) * 100
      setProgress(current)
    }
  }

  const handleSeek = (value: number[]) => {
    if (videoRef.current) {
      const time = (value[0] / 100) * videoRef.current.duration
      videoRef.current.currentTime = time
      setProgress(value[0])
    }
  }

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }

  return (
    <div className={cn("group relative overflow-hidden rounded-[2rem] bg-black border border-white/5 shadow-2xl", className)}>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        muted={isMuted}
        onTimeUpdate={handleTimeUpdate}
        className="w-full aspect-video object-cover"
        onClick={togglePlay}
      />
      
      {/* Control Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-6">
        {title && (
          <div className="absolute top-6 left-6">
            <h4 className="text-white font-bold tracking-tight text-sm uppercase italic">{title}</h4>
          </div>
        )}

        <div className="space-y-4">
          <Slider
            value={[progress]}
            max={100}
            step={0.1}
            onValueChange={handleSeek}
            className="w-full"
          />
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={togglePlay}
                className="h-10 w-10 text-white hover:bg-white/10 rounded-full"
              >
                {isPlaying ? <Pause className="h-5 w-5 fill-white" /> : <Play className="h-5 w-5 fill-white" />}
              </Button>
              
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if(videoRef.current) videoRef.current.currentTime = 0;
                }}
                className="h-10 w-10 text-white hover:bg-white/10 rounded-full"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              
              <div className="flex items-center gap-2 ml-4 group/vol">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleMute}
                  className="h-10 w-10 text-white hover:bg-white/10 rounded-full"
                >
                  <Volume2 className={cn("h-5 w-5", isMuted && "opacity-40")} />
                </Button>
                <Slider
                  value={[isMuted ? 0 : volume]}
                  max={100}
                  onValueChange={(val) => {
                    setVolume(val[0])
                    if (videoRef.current) videoRef.current.volume = val[0] / 100
                    if (val[0] > 0) setIsMuted(false)
                  }}
                  className="w-20 hidden group-hover/vol:block"
                />
              </div>
            </div>
            
            <Button
              variant="ghost"
              size="icon"
              onClick={() => videoRef.current?.requestFullscreen()}
              className="h-10 w-10 text-white hover:bg-white/10 rounded-full"
            >
              <Maximize className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
