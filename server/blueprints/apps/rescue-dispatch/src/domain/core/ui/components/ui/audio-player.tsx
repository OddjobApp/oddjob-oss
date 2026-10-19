"use client"

import * as React from "react"
import { Play, Pause, Volume2, Music } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from './button.js'
import { Slider } from './slider.js'

interface AudioPlayerProps {
  src: string
  title?: string
  artist?: string
  className?: string
  autoPlay?: boolean
}

export function AudioPlayer({
  src,
  title = "Unknown Track",
  artist = "Unknown Artist",
  className,
  autoPlay = false,
}: AudioPlayerProps) {
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [volume, setVolume] = React.useState(100)

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        audioRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const current = (audioRef.current.currentTime / audioRef.current.duration) * 100
      setProgress(current)
    }
  }

  const handleSeek = (value: number[]) => {
    if (audioRef.current) {
      const time = (value[0] / 100) * audioRef.current.duration
      audioRef.current.currentTime = time
      setProgress(value[0])
    }
  }

  return (
    <div className={cn("flex items-center gap-4 p-4 rounded-3xl bg-white/5 border border-white/5 backdrop-blur-xl shadow-xl", className)}>
      <audio
        ref={audioRef}
        src={src}
        autoPlay={autoPlay}
        onTimeUpdate={handleTimeUpdate}
      />
      
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center border border-white/10 shrink-0">
         <Music className="w-6 h-6 text-indigo-400" />
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center justify-between gap-4">
           <div className="truncate">
              <h4 className="text-sm font-bold truncate tracking-tight">{title}</h4>
              <p className="text-[10px] text-white/40 uppercase font-black tracking-widest">{artist}</p>
           </div>
           <Button
              variant="ghost"
              size="icon"
              onClick={togglePlay}
              className="h-10 w-10 text-white hover:bg-white/10 rounded-full shrink-0 bg-white/5"
           >
              {isPlaying ? <Pause className="h-5 w-5 fill-indigo-400 text-indigo-400" /> : <Play className="h-5 w-5 fill-indigo-400 text-indigo-400 ml-1" />}
           </Button>
        </div>
        
        <div className="flex items-center gap-3">
           <Slider
              value={[progress]}
              max={100}
              step={0.1}
              onValueChange={handleSeek}
              className="flex-1"
           />
           <div className="flex items-center gap-1.5 group/vol">
              <Volume2 className="h-3.5 w-3.5 text-white/30" />
              <Slider
                value={[volume]}
                max={100}
                onValueChange={(val) => {
                  setVolume(val[0])
                  if (audioRef.current) audioRef.current.volume = val[0] / 100
                }}
                className="w-12 hidden group-hover/vol:block"
              />
           </div>
        </div>
      </div>
    </div>
  )
}
