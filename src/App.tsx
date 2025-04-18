import './App.css'
import * as React from "react"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table"

const WANSTEAD_ID = "940GZZLUWSD"
const SNARESBROOK_ID = "940GZZLUSNB"
const TFL_URL = "https://api.tfl.gov.uk/StopPoint/{}/arrivals"
const MIN_GETTABLE = 5 * 60
const MAX_GETTABLE = 8 * 60

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
  const [_, setLastUpdate] = React.useState(Date.now())

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
      setDepartures(
        [...wansteadJson, ...snaresbrookJson]
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
      )
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

  // Re-render every second for live updates
  React.useEffect(() => {
    const interval = setInterval(() => setLastUpdate(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  return { departures }
}

function useCountdown(targetTime: string) {
  const [_, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])
  const diff = Math.max(0, new Date(targetTime).getTime() - Date.now())
  const min = Math.floor(diff / 60000)
  const sec = Math.floor((diff % 60000) / 1000)
  return diff > 0 ? `${min}:${sec.toString().padStart(2, "0")}` : "Departed"
}

function getStatusFromTime(targetTime: string) {
  const diffSec = Math.max(0, (new Date(targetTime).getTime() - Date.now()) / 1000)
  if (diffSec < MIN_GETTABLE) return "Too soon"
  if (diffSec <= MAX_GETTABLE) return "Gettable"
  return "Far away"
}

function LiveSuggestionCountdown({ departureTime }: { departureTime: string }) {
  const [_, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])
  const diff = Math.max(0, new Date(departureTime).getTime() - Date.now())
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

  // Re-render every second for live status updates
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const now = Date.now()
  const gettable = departures.filter(d => {
    const diffSec = Math.max(0, (new Date(d.departureTime).getTime() - now) / 1000)
    return diffSec >= MIN_GETTABLE && diffSec <= MAX_GETTABLE
  })

  let soonestGettable: Departure | null = null
  let altGettable: Departure | null = null
  if (gettable.length > 0) {
    soonestGettable = gettable.reduce((a, b) =>
      new Date(a.departureTime).getTime() < new Date(b.departureTime).getTime() ? a : b
    )
    altGettable = gettable.find(
      d =>
        d.id !== soonestGettable!.id &&
        new Date(d.departureTime).getTime() === new Date(soonestGettable!.departureTime).getTime() &&
        d.origin !== soonestGettable!.origin
    ) || null
  }

  const farAway = departures.filter(d => {
    const diffSec = Math.max(0, (new Date(d.departureTime).getTime() - now) / 1000)
    return diffSec > MAX_GETTABLE
  })
  let soonestFarAway: Departure | null = null
  let altFarAway: Departure | null = null
  if (farAway.length > 0) {
    soonestFarAway = farAway.reduce((a, b) =>
      new Date(a.departureTime).getTime() < new Date(b.departureTime).getTime() ? a : b
    )
    altFarAway = farAway.find(
      d =>
        d.id !== soonestFarAway!.id &&
        new Date(d.departureTime).getTime() === new Date(soonestFarAway!.departureTime).getTime() &&
        d.origin !== soonestFarAway!.origin
    ) || null
  }

  return (
    <div className="w-full max-w-2xl mx-auto py-8 px-2 sm:px-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Wanstead & Snaresbrook Departure Board</h1>
      </div>
      <div className="mb-4 p-4 rounded bg-green-100 text-green-900 font-medium flex flex-col items-start gap-2 w-full">
        <div className="text-lg font-semibold">Suggestion</div>
        {soonestGettable ? (
          altGettable ? (
            <>
              <div>
                Go to <span className="font-bold">{soonestGettable.origin}</span> or <span className="font-bold">{altGettable.origin}</span>
              </div>
              <div>
                For a train departing in <span className="font-bold">
                  <LiveSuggestionCountdown departureTime={soonestGettable.departureTime} />
                </span>
              </div>
            </>
          ) : (
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
          )
        ) : soonestFarAway ? (
          altFarAway ? (
            <>
              <div>
                Go to <span className="font-bold">{soonestFarAway.origin}</span> or <span className="font-bold">{altFarAway.origin}</span>
              </div>
              <div>
                For a train departing in <span className="font-bold">
                  <LiveSuggestionCountdown departureTime={soonestFarAway.departureTime} />
                </span>{" "}– no rush!
              </div>
            </>
          ) : (
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
          )
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

