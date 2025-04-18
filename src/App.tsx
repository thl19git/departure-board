import './App.css'
import * as React from "react"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table"

const WANSTEAD_ID = "940GZZLUWSD"
const SNARESBROOK_ID = "940GZZLUSNB"
const TFL_URL = "https://api.tfl.gov.uk/StopPoint/{}/arrivals"

type TflArrival = {
  id: string
  stationName: string
  destinationName: string
  timeToStation: number
  platformName: string
  expectedArrival: string
}

type Departure = {
  id: string
  origin: string
  destination: string
  departureTime: string
  timeToStation: number
}

function useDepartures() {
  const [departures, setDepartures] = React.useState<Departure[]>([])
  const [lastUpdate, setLastUpdate] = React.useState(Date.now())

  const fetchDepartures = React.useCallback(async () => {
    try {
      const [wansteadRes, snaresbrookRes] = await Promise.all([
        fetch(TFL_URL.replace("{}", WANSTEAD_ID)),
        fetch(TFL_URL.replace("{}", SNARESBROOK_ID)),
      ])
      const [wansteadJson, snaresbrookJson]: [TflArrival[], TflArrival[]] = await Promise.all([
        wansteadRes.json(),
        snaresbrookRes.json(),
      ])
      const allTrains = [...wansteadJson, ...snaresbrookJson]
        .filter(train =>
          train.platformName === "Outer Rail - Platform 1" ||
          train.platformName === "Westbound - Platform 1"
        )
        .sort((a, b) => a.timeToStation - b.timeToStation)
        .map(train => ({
          id: train.id,
          origin: train.stationName.replace(" Underground Station", ""),
          destination: train.destinationName.replace(" Underground Station", ""),
          departureTime: train.expectedArrival,
          timeToStation: train.timeToStation,
        }))
      setDepartures(allTrains)
      setLastUpdate(Date.now())
    } catch {
      setDepartures([])
    }
  }, [])

  React.useEffect(() => {
    fetchDepartures()
    const interval = setInterval(fetchDepartures, 30000)
    return () => clearInterval(interval)
  }, [fetchDepartures])

  React.useEffect(() => {
    const interval = setInterval(() => setLastUpdate(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  return { departures, lastUpdate }
}

function useCountdown(targetTime: string) {
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])
  const diff = Math.max(0, new Date(targetTime).getTime() - now)
  const min = Math.floor(diff / 60000)
  const sec = Math.floor((diff % 60000) / 1000)
  return diff > 0 ? `${min}:${sec.toString().padStart(2, "0")}` : "Departed"
}

function getStatusFromTime(targetTime: string) {
  const diff = Math.max(0, new Date(targetTime).getTime() - Date.now())
  if (diff < 5 * 60 * 1000) return "Too soon"
  if (diff <= 8 * 60 * 1000) return "Gettable"
  return "Far away"
}

function LiveSuggestionCountdown({ departureTime }: { departureTime: string }) {
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])
  const diff = Math.max(0, new Date(departureTime).getTime() - now)
  const min = Math.floor(diff / 60000)
  const sec = Math.floor((diff % 60000) / 1000)
  if (diff <= 0) return <span>Departed</span>
  return (
    <span>
      {min} minute{min !== 1 ? "s" : ""} and {sec} second{sec !== 1 ? "s" : ""}
    </span>
  )
}

function DepartureBoard() {
  const { departures } = useDepartures()

  // Force re-render every second for live status updates
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    const interval = setInterval(() => setTick(tick => tick + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const now = Date.now()
  const gettable = departures.filter(d => {
    const diff = Math.max(0, new Date(d.departureTime).getTime() - now)
    return diff >= 5 * 60 * 1000 && diff <= 8 * 60 * 1000
  })
  const soonestGettable = gettable.length > 0
    ? gettable.reduce((a, b) =>
        new Date(a.departureTime).getTime() < new Date(b.departureTime).getTime() ? a : b)
    : null

  const farAway = departures.filter(d => {
    const diff = Math.max(0, new Date(d.departureTime).getTime() - now)
    return diff > 8 * 60 * 1000
  })
  const soonestFarAway = farAway.length > 0
    ? farAway.reduce((a, b) =>
        new Date(a.departureTime).getTime() < new Date(b.departureTime).getTime() ? a : b)
    : null

  return (
    <div className="w-full max-w-2xl mx-auto py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Wanstead & Snaresbrook Departure Board</h1>
      </div>
      <div className="mb-4 p-4 rounded bg-green-100 text-green-900 font-medium flex flex-col items-start gap-2">
        <div className="text-lg font-semibold">Suggestion</div>
        {soonestGettable ? (
          <>
            <div>
              Go to <span className="font-bold">{soonestGettable.origin}</span> for the train to{" "}
              <span className="font-bold">{soonestGettable.destination}</span>
            </div>
            <div>
              Departing in <span className="font-bold">
                <LiveSuggestionCountdown departureTime={soonestGettable.departureTime} />
              </span>
            </div>
          </>
        ) : soonestFarAway ? (
          <>
            <div>
              Go to <span className="font-bold">{soonestFarAway.origin}</span> for the train to{" "}
              <span className="font-bold">{soonestFarAway.destination}</span>
            </div>
            <div>
              Departing in <span className="font-bold">
                <LiveSuggestionCountdown departureTime={soonestFarAway.departureTime} />
              </span>{" "}– no rush!
            </div>
          </>
        ) : (
          <div>No gettable or far away trains right now.</div>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Origin</TableHead>
            <TableHead>Destination</TableHead>
            <TableHead>Departs In</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {departures.map(dep => (
            <TableRow key={dep.id}>
              <TableCell>{dep.origin}</TableCell>
              <TableCell>{dep.destination}</TableCell>
              <TableCell>
                <CountdownCell departureTime={dep.departureTime} />
              </TableCell>
              <TableCell>
                {getStatusFromTime(dep.departureTime)}
              </TableCell>
            </TableRow>
          ))}
          {departures.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center">
                No departures found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function CountdownCell({ departureTime }: { departureTime: string }) {
  const countdown = useCountdown(departureTime)
  return <span>{countdown}</span>
}

function App() {
  return (
    <div className="flex flex-col items-center justify-center min-h-svh bg-background">
      <DepartureBoard />
    </div>
  )
}

export default App

