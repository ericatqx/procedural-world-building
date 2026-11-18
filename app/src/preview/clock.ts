import { useEffect, useState } from 'react'
import { environment, formatHour, type EnvironmentControls } from '../project03/environment.ts'

/** The world's clock and weather as the simulation holds them, read four times a second (as the 0.3 panel reads them). */
export type Clock = Pick<EnvironmentControls, 'hour' | 'day' | 'year' | 'playing' | 'scale' | 'speed' | 'yearSpeed'> & { weather: string }

function read(): Clock {
  const c = environment.controls
  const weather = c.conditions.rain ? 'Rain' : c.conditions.mist ? 'Mist' : c.conditions.overcast ? 'Overcast' : c.conditions.wind ? 'Wind' : 'Clear'
  return { hour: c.hour, day: c.day, year: c.year, playing: c.playing, scale: c.scale, speed: c.speed, yearSpeed: c.yearSpeed, weather }
}

export function useClock(): [Clock, () => void] {
  const [clock, setClock] = useState(read)
  useEffect(() => {
    const id = window.setInterval(() => {
      setClock((current) => {
        const next = read()
        const same = Math.round(current.hour * 4) === Math.round(next.hour * 4) && current.day === next.day && Math.floor(current.year) === Math.floor(next.year) && current.playing === next.playing && current.scale === next.scale && current.speed === next.speed && current.yearSpeed === next.yearSpeed && current.weather === next.weather
        return same ? current : next
      })
    }, 250)
    return () => window.clearInterval(id)
  }, [])
  return [clock, () => setClock(read())]
}

export { formatHour }
