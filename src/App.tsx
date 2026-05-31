import "./App.css"
import * as React from "react"
import { AlertTriangle, Clock, MapPin, TrainFront } from "lucide-react"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table"

const LINE_ID = "central"
const WANSTEAD_ID = "940GZZLUWSD"
const SNARESBROOK_ID = "940GZZLUSNB"
const MIN_GETTABLE = 5 * 60
const MAX_GETTABLE = 8 * 60
const LIVE_REFRESH_MS = 30000
const SCHEDULE_LOOKAHEAD_MINUTES = 90
const LIVE_EXPECTED_WINDOW_SECONDS = 20 * 60
const LIVE_MATCH_WINDOW_MS = 4 * 60 * 1000

const TARGET_STATIONS = new Set([WANSTEAD_ID, SNARESBROOK_ID])
const CENTRAL_LINE_PAGE = "https://api.tfl.gov.uk/Line/central/Status"

type TflArrival = {
  id: string
  vehicleId?: string
  naptanId: string
  stationName: string
  destinationName: string
  destinationNaptanId?: string
  timeToStation: number
  platformName: string
  direction?: string
  expectedArrival: string
  currentLocation?: string
  towards?: string
  timestamp?: string
}

type TflStatus = {
  lineStatuses?: {
    statusSeverity: number
    statusSeverityDescription: string
    reason?: string
  }[]
}

type KnownJourney = {
  hour: string
  minute: string
  intervalId: number
}

type TimetableSchedule = {
  name: string
  knownJourneys?: KnownJourney[]
}

type TimetableResponse = {
  stations?: {
    id: string
    name: string
  }[]
  timetable?: {
    routes?: {
      schedules?: TimetableSchedule[]
      stationIntervals?: {
        id: string
        intervals?: {
          stopId: string
          timeToArrival: number
        }[]
      }[]
    }[]
  }
}

type DepartureSource = "live" | "scheduled"

type Departure = {
  id: string
  originId: string
  origin: string
  destinationId?: string
  destination: string
  departureTime: string
  timeToStation: number
  source: DepartureSource
  vehicleId?: string
  currentLocation?: string
  platformName?: string
  reliability: "Live" | "Timetable"
  isUnconfirmedScheduled?: boolean
}

type ServiceStatus = {
  label: string
  severity: number
  reason?: string
}

type StationNode = {
  id: string
  name: string
  x: number
  y: number
  labelOffset?: number
}

type TrackSegment = {
  from: string
  to: string
  durationSec: number
}

type TrainMarker = {
  id: string
  label: string
  destination: string
  currentLocation?: string
  x: number
  y: number
  nextStation: string
  secondsToNext: number
  segmentKey: string
  progress: number
}

const STATIONS: StationNode[] = [
  { id: "940GZZLUNBP", name: "Newbury Park", x: 44, y: 78, labelOffset: -34 },
  { id: "940GZZLUGTH", name: "Gants Hill", x: 154, y: 78, labelOffset: -34 },
  { id: "940GZZLURBG", name: "Redbridge", x: 264, y: 78 },
  { id: WANSTEAD_ID, name: "Wanstead", x: 374, y: 78 },
  { id: "940GZZLUBKH", name: "Buckhurst Hill", x: 44, y: 254 },
  { id: "940GZZLUWOF", name: "Woodford", x: 154, y: 254 },
  { id: "940GZZLUSWF", name: "South Woodford", x: 264, y: 254 },
  { id: SNARESBROOK_ID, name: "Snaresbrook", x: 374, y: 254 },
  { id: "940GZZLULYS", name: "Leytonstone", x: 538, y: 166 },
]

const SEGMENTS: TrackSegment[] = [
  { from: "940GZZLUNBP", to: "940GZZLUGTH", durationSec: 120 },
  { from: "940GZZLUGTH", to: "940GZZLURBG", durationSec: 120 },
  { from: "940GZZLURBG", to: WANSTEAD_ID, durationSec: 90 },
  { from: WANSTEAD_ID, to: "940GZZLULYS", durationSec: 150 },
  { from: "940GZZLUBKH", to: "940GZZLUWOF", durationSec: 120 },
  { from: "940GZZLUWOF", to: "940GZZLUSWF", durationSec: 120 },
  { from: "940GZZLUSWF", to: SNARESBROOK_ID, durationSec: 120 },
  { from: SNARESBROOK_ID, to: "940GZZLULYS", durationSec: 180 },
]

const MAP_STATION_IDS = STATIONS.map(station => station.id)
const stationById = new Map(STATIONS.map(station => [station.id, station]))
const segmentByTo = new Map(SEGMENTS.map(segment => [segment.to, segment]))
const segmentByKey = new Map(SEGMENTS.map(segment => [`${segment.from}-${segment.to}`, segment]))

type TrainTrack = {
  segmentKey: string
  progress: number
  speedPerSecond: number
  updatedAt: number
}

function isWestboundCentralTrain(train: TflArrival) {
  return (
    train.direction === "inbound" ||
    train.platformName.includes("Westbound") ||
    train.platformName.includes("Outer Rail")
  )
}

function cleanStationName(name: string) {
  return name.replace(" Underground Station", "")
}

function secondsUntil(dateIso: string, now = Date.now()) {
  return Math.max(0, Math.round((new Date(dateIso).getTime() - now) / 1000))
}

function formatClock(dateIso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateIso))
}

function formatDuration(totalSeconds: number) {
  if (totalSeconds <= 0) return "Departed"
  const min = Math.floor(totalSeconds / 60)
  const sec = totalSeconds % 60
  if (min === 0) return `${sec}s`
  return `${min}m ${sec.toString().padStart(2, "0")}s`
}

function formatDepartureCountdown(totalSeconds: number) {
  if (totalSeconds <= 0) return "At Platform"
  return formatDuration(totalSeconds)
}

function getStatusFromSeconds(diffSec: number, departure: Departure) {
  if (departure.isUnconfirmedScheduled) return "Not live"
  if (departure.source === "scheduled") return "Scheduled"
  if (diffSec < MIN_GETTABLE) return "Too soon"
  if (diffSec <= MAX_GETTABLE) return "Gettable"
  return "Far away"
}

function getCompactStatusFromSeconds(diffSec: number, departure: Departure) {
  const status = getStatusFromSeconds(diffSec, departure)
  if (status === "Scheduled") return "Sched."
  if (status === "Far away") return "Far"
  return status
}

function getScheduleForToday(schedules: TimetableSchedule[] = []) {
  const day = new Date().getDay()
  const wanted = day === 0 ? "Sunday" : day === 6 ? "Saturday" : day === 5 ? "Friday" : "Monday - Thursday"
  return schedules.find(schedule => schedule.name.includes(wanted)) ?? schedules[0]
}

function timetableDate(hourText: string, minuteText: string) {
  const now = new Date()
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const date = new Date(now)
  date.setHours(hour % 24, minute, 0, 0)
  if (hour >= 24) date.setDate(date.getDate() + 1)
  if (date.getTime() < now.getTime() - 30 * 60000) date.setDate(date.getDate() + 1)
  return date
}

function buildScheduledDepartures(stationId: string, timetable: TimetableResponse): Departure[] {
  const route = timetable.timetable?.routes?.[0]
  const schedule = getScheduleForToday(route?.schedules)
  if (!schedule?.knownJourneys) return []

  const now = Date.now()
  const horizon = now + SCHEDULE_LOOKAHEAD_MINUTES * 60000
  const origin = stationById.get(stationId)?.name ?? stationId
  const stationNames = new Map(timetable.stations?.map(station => [station.id, cleanStationName(station.name)]))
  const intervalDestinations = new Map(route?.stationIntervals?.map(intervalGroup => {
    const destinationId = intervalGroup.intervals?.at(-1)?.stopId
    return [
      Number(intervalGroup.id),
      {
        id: destinationId,
        name: destinationId ? stationNames.get(destinationId) ?? "Central London" : "Central London",
      },
    ]
  }) ?? [])

  return schedule.knownJourneys
    .map(journey => ({
      date: timetableDate(journey.hour, journey.minute),
      destination: intervalDestinations.get(journey.intervalId),
    }))
    .filter(({ date }) => date.getTime() >= now && date.getTime() <= horizon)
    .slice(0, 8)
    .map(({ date, destination }) => ({
      id: `scheduled-${stationId}-${date.toISOString()}`,
      originId: stationId,
      origin,
      destinationId: destination?.id,
      destination: destination?.name ?? "Central London",
      departureTime: date.toISOString(),
      timeToStation: Math.round((date.getTime() - now) / 1000),
      source: "scheduled" as const,
      reliability: "Timetable" as const,
    }))
}

function coalesceDepartures(liveDepartures: Departure[], scheduledDepartures: Departure[]) {
  const annotatedScheduled = scheduledDepartures
    .filter(scheduled => !hasLiveMatch(scheduled, liveDepartures))
    .map(scheduled => {
      const secondsAway = secondsUntil(scheduled.departureTime)
      return {
        ...scheduled,
        isUnconfirmedScheduled: secondsAway <= LIVE_EXPECTED_WINDOW_SECONDS,
      }
    })

  return [...liveDepartures, ...annotatedScheduled]
    .sort((a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime())
    .slice(0, 16)
}

function filterDepartures(departures: Departure[], showUnconfirmedScheduled: boolean) {
  return departures.filter(departure => showUnconfirmedScheduled || !departure.isUnconfirmedScheduled)
}

function countUnconfirmedScheduled(departures: Departure[]) {
  return departures.filter(departure => departure.isUnconfirmedScheduled).length
}

function hasLiveMatch(scheduled: Departure, liveDepartures: Departure[]) {
  return liveDepartures.some(live =>
    live.originId === scheduled.originId &&
    destinationsMatch(scheduled, live) &&
    Math.abs(new Date(live.departureTime).getTime() - new Date(scheduled.departureTime).getTime()) < LIVE_MATCH_WINDOW_MS
  )
}

function destinationsMatch(a: Departure, b: Departure) {
  if (a.destinationId && b.destinationId) return a.destinationId === b.destinationId
  return a.destination.toLowerCase() === b.destination.toLowerCase()
}

function advanceTrack(track: TrainTrack, now: number) {
  const elapsedSeconds = Math.max(0, (now - track.updatedAt) / 1000)
  return Math.min(1, Math.max(0, track.progress + track.speedPerSecond * elapsedSeconds))
}

function isAtBlockingStation(marker: TrainMarker) {
  return marker.progress >= 0.96 || /^At /i.test(marker.currentLocation ?? "")
}

function placeMarkerOnSegment(segmentKey: string, progress: number, source: Omit<TrainMarker, "x" | "y" | "progress" | "segmentKey">): TrainMarker | null {
  const segment = segmentByKey.get(segmentKey)
  if (!segment) return null

  const from = stationById.get(segment.from)
  const to = stationById.get(segment.to)
  if (!from || !to) return null

  return {
    ...source,
    segmentKey,
    progress,
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  }
}

function applyStationBlocking(markers: TrainMarker[]) {
  const blockersByStation = new Map<string, TrainMarker>()

  for (const marker of [...markers].sort((a, b) => b.progress - a.progress)) {
    const segment = segmentByKey.get(marker.segmentKey)
    if (!segment || !isAtBlockingStation(marker)) continue
    blockersByStation.set(segment.to, marker)
  }

  return markers.map(marker => {
    const segment = segmentByKey.get(marker.segmentKey)
    if (!segment) return marker
    const blocker = blockersByStation.get(segment.to)
    if (!blocker || blocker.id === marker.id || marker.progress < 0.72) return marker

    const heldProgress = Math.min(marker.progress, Math.max(0, blocker.progress - 0.16))
    return placeMarkerOnSegment(marker.segmentKey, heldProgress, marker) ?? marker
  })
}

function buildTrainMarkers(predictions: TflArrival[], tracks: Map<string, TrainTrack>, now = Date.now()): TrainMarker[] {
  const byVehicle = new Map<string, TflArrival[]>()

  for (const prediction of predictions.filter(isWestboundCentralTrain)) {
    const vehicleKey = prediction.vehicleId || prediction.id
    const group = byVehicle.get(vehicleKey) ?? []
    group.push(prediction)
    byVehicle.set(vehicleKey, group)
  }

  const visibleVehicleIds = new Set<string>()
  const markers = [...byVehicle.entries()].flatMap(([vehicleId, group]) => {
    const sorted = group
      .filter(prediction => segmentByTo.has(prediction.naptanId))
      .sort((a, b) => secondsUntil(a.expectedArrival, now) - secondsUntil(b.expectedArrival, now))

    const next = sorted.find(prediction => {
      const segment = segmentByTo.get(prediction.naptanId)
      return segment && secondsUntil(prediction.expectedArrival, now) <= segment.durationSec + 45
    })

    if (!next) return []
    const segment = segmentByTo.get(next.naptanId)
    const to = stationById.get(next.naptanId)
    if (!segment || !to) return []

    const secondsToNext = secondsUntil(next.expectedArrival, now)
    const segmentKey = `${segment.from}-${segment.to}`
    const track = tracks.get(vehicleId)
    const observedProgress = Math.min(1, Math.max(0, 1 - secondsToNext / segment.durationSec))
    const previousSegment = track ? segmentByKey.get(track.segmentKey) : undefined
    const isAdjacentHandoff = previousSegment?.to === segment.from
    const currentProgress = track?.segmentKey === segmentKey
      ? advanceTrack(track, now)
      : isAdjacentHandoff
        ? 0
        : observedProgress
    const remainingSeconds = Math.max(1, secondsToNext)
    const speedPerSecond = (1 - currentProgress) / remainingSeconds
    const nextTrack = {
      segmentKey,
      progress: currentProgress,
      speedPerSecond,
      updatedAt: now,
    }
    tracks.set(vehicleId, nextTrack)
    visibleVehicleIds.add(vehicleId)

    return [placeMarkerOnSegment(segmentKey, currentProgress, {
      id: vehicleId,
      label: vehicleId,
      destination: cleanStationName(next.destinationName),
      currentLocation: next.currentLocation,
      nextStation: to.name,
      secondsToNext,
    })].filter(marker => marker !== null)
  })

  for (const vehicleId of tracks.keys()) {
    if (!visibleVehicleIds.has(vehicleId)) tracks.delete(vehicleId)
  }

  return applyStationBlocking(markers)
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`TfL request failed: ${response.status}`)
  return response.json()
}

function useDepartureData() {
  const [departures, setDepartures] = React.useState<Departure[]>([])
  const [mapPredictions, setMapPredictions] = React.useState<TflArrival[]>([])
  const [serviceStatus, setServiceStatus] = React.useState<ServiceStatus | null>(null)
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const fetchData = React.useCallback(async () => {
    try {
      const [predictionGroups, wansteadTimetable, snaresbrookTimetable, lineStatus] = await Promise.all([
        Promise.all(MAP_STATION_IDS.map(stationId =>
          getJson<TflArrival[]>(`https://api.tfl.gov.uk/Line/${LINE_ID}/Arrivals/${stationId}`)
        )),
        getJson<TimetableResponse>(`https://api.tfl.gov.uk/Line/${LINE_ID}/Timetable/${WANSTEAD_ID}?direction=inbound`),
        getJson<TimetableResponse>(`https://api.tfl.gov.uk/Line/${LINE_ID}/Timetable/${SNARESBROOK_ID}?direction=inbound`),
        getJson<TflStatus[]>(CENTRAL_LINE_PAGE),
      ])

      const allPredictions = predictionGroups.flat().filter(isWestboundCentralTrain)
      const liveDepartures = allPredictions
        .filter(train => TARGET_STATIONS.has(train.naptanId))
        .map(train => ({
          id: train.id,
          originId: train.naptanId,
          origin: cleanStationName(train.stationName),
          destinationId: train.destinationNaptanId,
          destination: cleanStationName(train.destinationName),
          departureTime: train.expectedArrival,
          timeToStation: train.timeToStation,
          source: "live" as const,
          vehicleId: train.vehicleId,
          currentLocation: train.currentLocation,
          platformName: train.platformName,
          reliability: "Live" as const,
        }))

      const scheduledDepartures = [
        ...buildScheduledDepartures(WANSTEAD_ID, wansteadTimetable),
        ...buildScheduledDepartures(SNARESBROOK_ID, snaresbrookTimetable),
      ]

      const bestStatus = lineStatus[0]?.lineStatuses?.reduce((mostSevere, current) =>
        current.statusSeverity < mostSevere.statusSeverity ? current : mostSevere
      )

      setDepartures(coalesceDepartures(liveDepartures, scheduledDepartures))
      setMapPredictions(allPredictions)
      setServiceStatus(bestStatus ? {
        label: bestStatus.statusSeverityDescription,
        severity: bestStatus.statusSeverity,
        reason: bestStatus.reason,
      } : null)
      setLastUpdated(new Date())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load TfL data")
      setDepartures([])
      setMapPredictions([])
    }
  }, [])

  React.useEffect(() => {
    fetchData()
    const interval = window.setInterval(fetchData, LIVE_REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [fetchData])

  return { departures, mapPredictions, serviceStatus, lastUpdated, error, refresh: fetchData }
}

function useNow() {
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])
  return now
}

function getSuggestion(departures: Departure[], serviceStatus: ServiceStatus | null, now: number) {
  const live = departures.filter(departure => departure.source === "live")
  const gettable = live.filter(departure => {
    const diffSec = secondsUntil(departure.departureTime, now)
    return diffSec >= MIN_GETTABLE && diffSec <= MAX_GETTABLE
  })
  const laterLive = live.filter(departure => secondsUntil(departure.departureTime, now) > MAX_GETTABLE)
  const laterScheduled = departures.filter(departure =>
    departure.source === "scheduled" &&
    secondsUntil(departure.departureTime, now) >= MIN_GETTABLE
  )
  const candidates = gettable.length > 0 ? gettable : laterLive.length > 0 ? laterLive : laterScheduled
  const best = candidates[0] ?? null

  if (!best) {
    const nextTooSoon = live.find(departure => secondsUntil(departure.departureTime, now) < MIN_GETTABLE)
    return {
      title: "No usable westbound prediction",
      body: nextTooSoon
        ? `The next live train from ${nextTooSoon.origin} is too soon to target. Wait for the next confirmed departure.`
        : serviceStatus?.severity && serviceStatus.severity < 10
        ? "TfL is reporting disruption and no live train can currently be targeted."
        : "No live or scheduled departure is available right now.",
      train: null as Departure | null,
    }
  }

  const diffSec = secondsUntil(best.departureTime, now)
  const isDisrupted = serviceStatus?.severity && serviceStatus.severity < 10
  const prefix = best.source === "live" ? "Target" : "Plan for"
  const caution = isDisrupted ? " Check the disruption banner before leaving." : ""

  return {
    title: `${prefix} ${best.origin}`,
    body: `${best.destination} train at ${formatClock(best.departureTime)}, in ${formatDuration(diffSec)}.${caution}`,
    train: best,
  }
}

function useTrainMarkers(predictions: TflArrival[], now: number) {
  const tracksRef = React.useRef(new Map<string, TrainTrack>())
  return React.useMemo(() => buildTrainMarkers(predictions, tracksRef.current, now), [predictions, now])
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-sm font-medium text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 rounded-full transition-colors after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform ${checked ? "bg-slate-950 after:translate-x-5" : "bg-slate-200"} outline-offset-2`}
      />
    </button>
  )
}

function MiniMap({ predictions, now }: { predictions: TflArrival[], now: number }) {
  const trains = useTrainMarkers(predictions, now)

  return (
    <section className="min-w-0 w-full self-start rounded-md border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Live train map</h2>
          <p className="text-sm text-muted-foreground">Central line westbound branches into Leytonstone</p>
        </div>
        <div className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
          <TrainFront className="h-3.5 w-3.5" />
          {trains.length} live
        </div>
      </div>
      <svg viewBox="0 0 600 318" role="img" aria-label="Mini map of westbound Central line trains" className="h-auto w-full">
        <defs>
          <filter id="train-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.25" />
          </filter>
        </defs>
        {SEGMENTS.map(segment => {
          const from = stationById.get(segment.from)!
          const to = stationById.get(segment.to)!
          return (
            <line
              key={`${segment.from}-${segment.to}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#dc241f"
              strokeWidth="10"
              strokeLinecap="round"
            />
          )
        })}
        {STATIONS.map(station => (
          <g key={station.id}>
            <circle cx={station.x} cy={station.y} r="11" fill="white" stroke="#1f2937" strokeWidth="3" />
            <text x={station.x} y={station.y + (station.labelOffset ?? (station.y > 180 ? 30 : -22))} textAnchor="middle" className="fill-slate-800 text-[12px] font-semibold">
              {station.name.split(" ").map((word, index, words) => (
                <tspan key={word} x={station.x} dy={index === 0 ? 0 : 14}>
                  {words.length > 2 && index === 1 ? `${word} ` : word}
                </tspan>
              ))}
            </text>
          </g>
        ))}
        {trains.map(train => (
          <g key={train.id} transform={`translate(${train.x - 13} ${train.y - 12})`} filter="url(#train-shadow)" aria-label={`Train to ${train.destination}`}>
            <rect x="0" y="0" width="26" height="24" rx="7" fill="#111827" />
            <rect x="5" y="4" width="16" height="8" rx="2" fill="#f8fafc" />
            <circle cx="8" cy="18" r="2" fill="#f8fafc" />
            <circle cx="18" cy="18" r="2" fill="#f8fafc" />
            <path d="M8 23h10" stroke="#f8fafc" strokeWidth="2" strokeLinecap="round" />
          </g>
        ))}
        {trains.length === 0 && (
          <text x="300" y="164" textAnchor="middle" className="fill-slate-500 text-[14px]">
            No nearby live train positions
          </text>
        )}
      </svg>
    </section>
  )
}

function SuggestionPanel({
  suggestion,
  serviceStatus,
}: {
  suggestion: ReturnType<typeof getSuggestion>
  serviceStatus: ServiceStatus | null
}) {
  const isDisrupted = serviceStatus?.severity && serviceStatus.severity < 10

  return (
    <section className={`w-full rounded-md border p-4 shadow-sm ${isDisrupted ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
      <div className="mb-2 flex items-center gap-2">
        {isDisrupted ? <AlertTriangle className="h-5 w-5 text-amber-700" /> : <MapPin className="h-5 w-5 text-emerald-700" />}
        <h2 className="text-lg font-semibold">{suggestion.title}</h2>
      </div>
      <p className="text-sm sm:text-base">{suggestion.body}</p>
      {suggestion.train?.currentLocation && (
        <p className="mt-2 text-sm text-muted-foreground">Now: {suggestion.train.currentLocation}</p>
      )}
      {serviceStatus && (
        <div className="mt-3 rounded-md bg-white/70 px-3 py-2 text-sm">
          <span className="font-medium">Central line: {serviceStatus.label}</span>
          {serviceStatus.reason ? <span className="block text-muted-foreground">{serviceStatus.reason}</span> : null}
        </div>
      )}
    </section>
  )
}

function DepartureBoard() {
  const { departures, mapPredictions, serviceStatus, lastUpdated, error } = useDepartureData()
  const now = useNow()
  const [showUnconfirmedScheduled, setShowUnconfirmedScheduled] = React.useState(false)
  const visibleDepartures = React.useMemo(
    () => filterDepartures(departures, showUnconfirmedScheduled),
    [departures, showUnconfirmedScheduled]
  )
  const hiddenScheduledCount = React.useMemo(() => countUnconfirmedScheduled(departures), [departures])
  const suggestion = React.useMemo(() => getSuggestion(visibleDepartures, serviceStatus, now), [visibleDepartures, serviceStatus, now])

  return (
    <main className="mx-auto w-full max-w-6xl overflow-x-hidden px-3 py-6 sm:px-6 lg:py-8">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-normal sm:text-3xl">Wanstead & Snaresbrook Departure Board</h1>
          <p className="text-sm text-muted-foreground">Westbound Central line trains into central London</p>
        </div>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          {lastUpdated ? `Updated ${formatClock(lastUpdated.toISOString())}` : "Loading TfL data"}
        </div>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(480px,1.05fr)_minmax(420px,0.95fr)] lg:items-start">
        <div className="min-w-0 flex flex-col gap-4">
          <SuggestionPanel suggestion={suggestion} serviceStatus={serviceStatus} />
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              {error}
            </div>
          )}
          <section className="min-w-0 overflow-hidden rounded-md border bg-white shadow-sm">
            <div className="relative border-b px-3 py-3 pr-36">
              <div className="min-w-0">
                <h2 className="text-base font-semibold">Departures</h2>
                <p className="text-sm text-muted-foreground">
                  {hiddenScheduledCount > 0
                    ? `${hiddenScheduledCount} near-term timetable train${hiddenScheduledCount === 1 ? "" : "s"} hidden without live confirmation`
                    : "Live predictions with timetable fallback"}
                </p>
              </div>
              <div className="absolute right-3 top-3">
                <ToggleSwitch
                  checked={showUnconfirmedScheduled}
                  onChange={setShowUnconfirmedScheduled}
                  label="Unconfirmed"
                />
              </div>
            </div>
            <Table className="table-fixed text-xs sm:table-auto sm:text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[28%] px-1 sm:w-auto sm:px-2">Origin</TableHead>
                  <TableHead className="w-[29%] px-1 sm:w-auto sm:px-2">Destination</TableHead>
                  <TableHead className="w-[22%] px-1 sm:w-auto sm:px-2">Departs</TableHead>
                  <TableHead className="w-[21%] px-1 sm:w-auto sm:px-2">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleDepartures.map(dep => {
                  const diffSec = secondsUntil(dep.departureTime, now)
                  return (
                    <TableRow key={dep.id} className={suggestion.train?.id === dep.id ? "bg-emerald-50" : dep.isUnconfirmedScheduled ? "bg-slate-50 text-slate-500" : undefined}>
                      <TableCell className="px-1 sm:px-2">
                        <div className="font-medium">{dep.origin}</div>
                        <div className="text-xs text-muted-foreground">
                          {dep.isUnconfirmedScheduled ? "Timetable only" : dep.reliability}
                        </div>
                      </TableCell>
                      <TableCell className="px-1 sm:px-2">{dep.destination}</TableCell>
                      <TableCell className="px-1 sm:px-2">
                        <div className="font-medium">{formatDepartureCountdown(diffSec)}</div>
                        <div className="text-xs text-muted-foreground">{formatClock(dep.departureTime)}</div>
                      </TableCell>
                      <TableCell className="px-1 sm:px-2">
                        <span className="sm:hidden">{getCompactStatusFromSeconds(diffSec, dep)}</span>
                        <span className="hidden sm:inline">{getStatusFromSeconds(diffSec, dep)}</span>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {visibleDepartures.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center">
                      No departures found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </section>
        </div>

        <MiniMap predictions={mapPredictions} now={now} />
      </div>
    </main>
  )
}

function App() {
  return (
    <div className="min-h-svh bg-slate-100 text-slate-950">
      <DepartureBoard />
    </div>
  )
}

export default App
