export type Status = 'saved' | 'preparing' | 'submitted' | 'interview' | 'awarded' | 'rejected' | 'withdrawn' | 'missed'

export const STATUSES: { id: Status; label: string; hint: string }[] = [
  { id: 'saved', label: 'Saved', hint: 'Found it, not started' },
  { id: 'preparing', label: 'Preparing', hint: 'Working on documents' },
  { id: 'submitted', label: 'Submitted', hint: 'Application sent' },
  { id: 'interview', label: 'Interview', hint: 'Shortlisted or interviewing' },
  { id: 'awarded', label: 'Awarded', hint: 'You got it' },
  { id: 'rejected', label: 'Rejected', hint: 'Not successful' },
  { id: 'withdrawn', label: 'Withdrawn', hint: 'You pulled out' },
  { id: 'missed', label: 'Missed', hint: 'Deadline passed' },
]
export const OPEN_STATUSES: Status[] = ['saved', 'preparing']
export const ACTIVE_STATUSES: Status[] = ['saved', 'preparing', 'submitted', 'interview']
export const statusLabel = (s: Status) => STATUSES.find((x) => x.id === s)?.label ?? s

export type DeadlineKind = 'scholarship' | 'admission' | 'referee' | 'offer' | 'opens' | 'other'
export const DEADLINE_KINDS: { id: DeadlineKind; label: string }[] = [
  { id: 'scholarship', label: 'Scholarship deadline' },
  { id: 'admission', label: 'Admission deadline' },
  { id: 'referee', label: 'Referee deadline' },
  { id: 'offer', label: 'Offer acceptance' },
  { id: 'opens', label: 'Opens on' },
  { id: 'other', label: 'Other' },
]

export interface Deadline {
  id: string
  kind: DeadlineKind
  date: string // YYYY-MM-DD
  time?: string // HH:mm, 24h
  tz?: string // IANA zone the deadline is expressed in
  label?: string
}

export interface Funding {
  type?: 'full' | 'partial' | 'unknown'
  summary?: string
  covers: string[]
  amount?: number
  currency?: string
}

export interface Criteria {
  nationalities: string[]
  degreeLevels: string[]
  fields: string[]
  minGpa?: number
  maxAge?: number
  other: string[]
}

export type RequirementKind = 'document' | 'essay' | 'referee' | 'test' | 'fee' | 'other'
export interface Requirement {
  id: string
  label: string
  kind: RequirementKind
  done: boolean
  note?: string
}

export interface StatusChange { at: string; from: Status | null; to: Status }

export interface Application {
  id: string
  title: string
  organisationId: string | null // the university
  funder: string | null
  programme: string
  degreeLevel: string
  country: string
  status: Status
  deadlines: Deadline[]
  funding: Funding
  criteria: Criteria
  requirements: Requirement[]
  sourceUrl: string
  officialUrl: string
  sourceKind: SourceKind
  notes: string
  custom: Record<string, string>
  confidence: Record<string, number>
  evidence: Record<string, string>
  needsReview: boolean
  verified: boolean
  scamFlags: ScamFlag[]
  fee?: number
  nextCycleOn?: string
  thumbnail?: string // legacy: older versions kept the screenshot thumbnail inline
  hasThumb?: boolean // a thumbnail is stored separately (see thumbs.ts)
  lastCheckedAt?: string // when the source page was last re-read
  changeNote?: string // set when a re-read finds the page now says something different
  pendingDeadline?: { date: string; time?: string; tz?: string }
  captureId?: string
  history: StatusChange[]
  createdAt: string
  updatedAt: string
}

export type SourceKind = 'whatsapp' | 'x' | 'linkedin' | 'telegram' | 'facebook' | 'instagram' | 'blog' | 'official' | 'screenshot' | 'import' | 'manual' | 'shared'

export interface ScamFlag { id: string; severity: 'high' | 'medium'; text: string }

export interface Organisation {
  id: string
  name: string
  kind: 'university' | 'funder'
  country?: string
  city?: string
  website?: string
  admissionsUrl?: string
}

export type FieldType = 'text' | 'date' | 'select' | 'url' | 'number' | 'money'
export interface FieldDef {
  id: string
  key: string
  label: string
  type: FieldType
  options?: string[]
  isDefault: boolean
  order: number
  hidden?: boolean
}

export interface Profile {
  name: string
  email: string
  country: string
  nationality: string
  degreeLevel: string // target level
  fields: string[] // fields of study
  gpa?: number
  sources: string[]
  view: 'list' | 'table' | 'board'
  groupBy: 'university' | 'funder'
  currency: string
  tz: string
  fx: Record<string, number> // user-entered rates to the home currency, optional
  remindDays: number[]
  emailReminders: boolean
  onboarded: boolean
  theme?: 'system' | 'light' | 'dark'
  consentAt?: string
  createdAt: string
}

export type CaptureKind = 'link' | 'paste' | 'screenshot' | 'import' | 'share'
export type CaptureState = 'queued' | 'parsing' | 'needs_review' | 'done' | 'failed'
export interface Capture {
  id: string
  kind: CaptureKind
  payload: string // url or text (trimmed)
  state: CaptureState
  error?: string
  applicationId?: string
  createdAt: string
}

export interface Essay {
  id: string
  title: string
  prompt: string
  body: string
  tags: string[]
  applicationIds: string[]
  updatedAt: string
}

export interface RefereeAsk { applicationId: string; askedAt: string; submittedAt?: string }
export interface Referee {
  id: string
  name: string
  email: string
  org: string
  asks: RefereeAsk[]
  notes: string
}

export interface VaultDocMeta {
  id: string
  name: string
  kind: 'cv' | 'transcript' | 'certificate' | 'test' | 'passport' | 'other'
  size: number
  mime: string
  expiresOn?: string
  addedAt: string
}

export interface PlanTask {
  id: string
  applicationId: string
  label: string
  due: string
  done: boolean
  auto: boolean
}

export interface AppState {
  profile: Profile
  fields: FieldDef[]
  orgs: Organisation[]
  apps: Application[]
  captures: Capture[]
  essays: Essay[]
  referees: Referee[]
  vault: VaultDocMeta[]
  tasks: PlanTask[]
  shownReminders: string[]
  dismissed: string[]
  mentees: Mentee[]
}

/** A student who shared a mentor link with this user (counsellor view). The token is the read-only snapshot itself. */
export interface Mentee { id: string; token: string; addedAt: string }

export interface ParsedDeadline { kind: DeadlineKind; date: string; time?: string; tz?: string; label?: string }
export interface ParseResult {
  title?: string
  university?: string
  funder?: string
  programme?: string
  degreeLevel?: string
  country?: string
  deadlines: ParsedDeadline[]
  funding?: Partial<Funding>
  criteria?: Partial<Criteria>
  requirements: { label: string; kind: RequirementKind }[]
  officialUrl?: string
  applicationUrl?: string
  custom: Record<string, string>
  confidence: Record<string, number>
  evidence: Record<string, string>
  notes?: string
  // transport metadata
  dropped?: string[]
  error?: string
  retryAfter?: number
  mode?: 'gemini' | 'none' | 'heuristic'
  blocked?: boolean
  blockedReason?: string
  sourceText?: string
  fetchedUrl?: string
  model?: string
}
