import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpRight, Bell, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, ClipboardCheck, Copy, Database, Download, Eye, FileCheck, FileText, KeyRound, LayoutDashboard, LockKeyhole, LogOut, Menu, Pencil, Plus, RefreshCw, Search, Settings2, Sheet, ShieldCheck, Trash2, Upload, UsersRound, X } from 'lucide-react'
import readXlsxFile from 'read-excel-file/browser'
import writeXlsxFile from 'write-excel-file/browser'
import ExpertiseView from './components/ExpertiseView.jsx'
import NizomView from './components/NizomView.jsx'
import { REQUIRED_DOCUMENTS } from './data/expertiseData.js'
import { STUDY_PLANS } from './data/studyPlanData.js'
import { KengashStudentView, KengashAdminView } from './components/KengashView.jsx'
import { PostDefenseStudentView, PostDefenseAdminView } from './components/PostDefenseView.jsx'
import ExecutiveDashboard from './components/ExecutiveDashboard.jsx'
import {
  changePassword,
  downloadBackup,
  fetchCurrentUser,
  flushServerChanges,
  fetchServerSync,
  getToken,
  loginRequest,
  logout as apiLogout,
  onConnectionChange,
  onUnauthorized,
  openOrDownloadFile,
  pushServerChanges,
  restoreBackup,
  startLiveSync,
  uploadRealFile
} from './api/apiService'
import { applyDiff, computeDiff, rebase } from './utils/syncDiff.js'
import { uid } from './utils/id.js'
import './App.css'

function readRoute() {
  const hash = (window.location.hash || '').toLowerCase().replace(/^#/, '')
  if (!hash) return { page: 'overview', stage: 1 }

  // Check stage pattern like #plans-stage-2 or #monitoring-stage-3
  const stageMatch = hash.match(/(?:plans|monitoring|rejalar)-stage-([123])/)
  const stage = stageMatch ? Number(stageMatch[1]) : 1

  const cleanHash = hash.replace(/-stage-[123]/, '')

  // Full Route Aliasing to eliminate 404 / blank screens
  const aliasMap = {
    overview: 'overview',
    bosh: 'overview',
    asosiy: 'overview',
    dashboard: 'overview',

    people: 'people',
    researchers: 'people',
    izlanuvchilar: 'people',
    talabgorlar: 'people',

    plans: 'plans',
    monitoring: 'plans',
    rejalar: 'plans',
    reja: 'plans',

    expertise: 'expertise',
    'dastlabki-ekspertiza': 'expertise',
    muhokama: 'expertise',

    seminar: 'seminar',
    seminarga: 'seminar',
    'ilmiy-seminar': 'seminar',

    kengash: 'kengash',
    kengashga: 'kengash',
    'bir-martalik-kengash': 'kengash',

    post_defense: 'post_defense',
    'post-defense': 'post_defense',
    postdefense: 'post_defense',
    himoya: 'post_defense',
    oak: 'post_defense',

    nizom: 'nizom',
    regulations: 'nizom',
    meyorlar: 'nizom',

    analytics: 'analytics',
    reports: 'analytics',
    tahlil: 'analytics',
    statistika: 'analytics',

    settings: 'settings',
    sozlamalar: 'settings',

    login: 'login',
    kirish: 'login',
  }

  const page = aliasMap[cleanHash] || 'overview'
  return { page, stage }
}

function normalizeHeader(value) {
  return String(value ?? '').trim().toLocaleLowerCase().replace(/[‘’ʻʼ`]/g, '').replace(/[^a-zа-яёўғқҳ0-9]+/g, '')
}

function stageFromAdmissionYear(value, currentYear = new Date().getFullYear()) {
  const year = value instanceof Date
    ? value.getFullYear()
    : Number(String(value ?? '').match(/\b(?:19|20)\d{2}\b/)?.[0])
  if (!year) return null
  return Math.min(3, Math.max(1, currentYear - year + 1))
}

function currentAcademicYear(date = new Date()) {
  const year = date.getFullYear()
  const startYear = date.getMonth() >= 8 ? year : year - 1
  return `${startYear}–${startYear + 1}`
}

function excelValue(researcher, aliases) {
  const entry = Object.entries(researcher?.excelData || {}).find(([header]) => aliases.includes(normalizeHeader(header)))
  return entry?.[1] ?? ''
}

function valueProgress(value) {
  const text = String(value ?? '').trim().toLocaleLowerCase()
  if (!text) return null
  const percent = text.match(/(\d+(?:[.,]\d+)?)\s*%/)
  if (percent) return Math.min(100, Number(percent[1].replace(',', '.')))
  const numeric = Number(text.replace(',', '.'))
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 100) return numeric
  if (/(yo'q|yo‘q|mavjud emas|bajarilmadi|topshirilmagan|rad etildi|no|false)/.test(text)) return 0
  if (/(jarayon|ko'rib chiqilmoqda|ko‘rib chiqilmoqda|kutilmoqda|tayyorlan|qisman)/.test(text)) return 50
  if (/(bajarildi|bajarilgan|topshirildi|tasdiqlandi|e'lon qilindi|chop etildi|muvaffaqiyatli|o'tdi|o‘tdi)/.test(text) || /^(ha|yes|true)$/.test(text)) return 100
  return null
}

function researcherProgress(researcher) {
  if (!researcher) return null
  if (!researcher.excelData) return Number.isFinite(researcher.progress) ? researcher.progress : null
  const monitored = [
    excelValue(researcher, ['monitoring2025']),
    excelValue(researcher, ['monitoring2026']),
    excelValue(researcher, ['yakkatartibdagireja']),
    excelValue(researcher, ['bajarganligi']),
    excelValue(researcher, ['oakkbyulletene`lonqilinganligi', 'oakbyulletene`lonqilinganligi']),
    excelValue(researcher, ['ixtisoslikimtihoni']),
    excelValue(researcher, ['chettilibo`yicha', 'chettiliboyicha']),
    excelValue(researcher, ['qoshimchaimtihon']),
    excelValue(researcher, ['amaliyotgajoriyqilingan']),
  ].map(valueProgress).filter((score) => score !== null)
  return monitored.length ? Math.round(monitored.reduce((sum, score) => sum + score, 0) / monitored.length) : null
}

function researcherStatus(researcher) {
  const progress = researcherProgress(researcher)
  if (progress === null) return null
  if (progress < 40) return 'atRisk'
  if (progress < 70) return 'needsReview'
  return 'inProgress'
}

function getResearcherStatusText(researcher, locale = 'uz') {
  const status = researcherStatus(researcher)
  const map = {
    uz: { inProgress: 'Reja bo‘yicha', needsReview: 'Ko‘rib chiqish kerak', atRisk: 'E’tibor kerak', unknown: 'Ma’lumot yo‘q' },
    ru: { inProgress: 'По плану', needsReview: 'Требует проверки', atRisk: 'Требует внимания', unknown: 'Нет данных' },
    en: { inProgress: 'On track', needsReview: 'Needs review', atRisk: 'Needs attention', unknown: 'No data' }
  }
  return map[locale]?.[status || 'unknown'] || map.uz[status || 'unknown']
}

function makeCredentials(name, existingAccounts) {
  const base = name.normalize('NFKD').toLocaleLowerCase().replace(/[‘’ʻʼ`]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'izlanuvchi'
  const usernames = new Set(existingAccounts.map((account) => account.username))
  let username = base
  let suffix = 2
  while (usernames.has(username)) username = `${base}${suffix++}`
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  const random = new Uint8Array(14)
  globalThis.crypto.getRandomValues(random)
  const password = Array.from(random, (value) => alphabet[value % alphabet.length]).join('')
  return { username, password }
}

const COLLECTION_KEYS = ['accounts', 'researchers', 'expertiseCases', 'monitoringFiles', 'monitoringReports', 'kengashFiles', 'postDefenseFiles', 'activityLog', 'normativeDocuments']
const ACTIVITY_LOG_LIMIT = 50

function nowTime() {
  return new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function getPaginationRange(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, '...', totalPages]
  }
  if (currentPage >= totalPages - 3) {
    return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }
  return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages]
}

function App() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'dark' } catch { return 'dark' }
  })
  useEffect(() => {
    try { localStorage.setItem('theme', theme) } catch { }
    document.body.className = theme + '-mode'
  }, [theme])

  const [locale, setLocale] = useState(() => {
    try { return localStorage.getItem('ilm_locale') || 'uz' } catch { return 'uz' }
  })
  useEffect(() => {
    try { localStorage.setItem('ilm_locale', locale) } catch { }
  }, [locale])

  const [route, setRoute] = useState(readRoute)
  const { page, stage } = route
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [pageSize, setPageSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('ilm_page_size'))
      return [10, 30, 60, 100].includes(saved) ? saved : 10
    } catch {
      return 10
    }
  })
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    try { localStorage.setItem('ilm_page_size', String(pageSize)) } catch { }
  }, [pageSize])

  useEffect(() => {
    setCurrentPage(1)
  }, [filter, query, pageSize])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [seminarMenuOpen, setSeminarMenuOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newField, setNewField] = useState('')
  const [newStage, setNewStage] = useState('1')

  // Server ma'lumotlari (yagona manba — server; brauzerda saqlanmaydi)
  const [accounts, setAccounts] = useState([])
  const [researchers, setResearchers] = useState([])
  const [expertiseCases, setExpertiseCases] = useState([])
  const [monitoringFiles, setMonitoringFiles] = useState([])
  const [monitoringReports, setMonitoringReports] = useState([])
  const [kengashFiles, setKengashFiles] = useState([])
  const [postDefenseFiles, setPostDefenseFiles] = useState([])
  const [activityLog, setActivityLog] = useState([])
  const [normativeDocuments, setNormativeDocuments] = useState([])

  const [credentialResult, setCredentialResult] = useState([])
  const [credentialModalOpen, setCredentialModalOpen] = useState(false)
  const [selectedResearcher, setSelectedResearcher] = useState(null)
  const [editingResearcher, setEditingResearcher] = useState(null)

  const setters = useMemo(() => ({
    accounts: setAccounts,
    researchers: setResearchers,
    expertiseCases: setExpertiseCases,
    monitoringFiles: setMonitoringFiles,
    monitoringReports: setMonitoringReports,
    kengashFiles: setKengashFiles,
    postDefenseFiles: setPostDefenseFiles,
    activityLog: setActivityLog,
    normativeDocuments: setNormativeDocuments
  }), [])

  // Autentifikatsiya va sinxronizatsiya holati
  const [authUser, setAuthUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(() => !getToken())
  const [dataLoaded, setDataLoaded] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [lastSyncTime, setLastSyncTime] = useState('')
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [pushTick, setPushTick] = useState(0)
  const snapshotRef = useRef(null) // serverdagi oxirgi ma'lum holat
  const revisionRef = useRef(0)
  const pushInFlight = useRef(false)

  const [normativeError, setNormativeError] = useState('')
  const normativeInputRef = useRef(null)
  const [importError, setImportError] = useState('')
  const [loginError, setLoginError] = useState('')
  const importInputRef = useRef(null)
  const restoreInputRef = useRef(null)

  useEffect(() => onConnectionChange(setIsOnline), [])

  const resetSession = useCallback((message = '') => {
    apiLogout()
    snapshotRef.current = null
    revisionRef.current = 0
    for (const key of COLLECTION_KEYS) setters[key]([])
    setDataLoaded(false)
    setAuthUser(null)
    setSelectedResearcher(null)
    setEditingResearcher(null)
    setCredentialResult([])
    setCredentialModalOpen(false)
    setLoginError(message)
  }, [setters])

  useEffect(() => {
    onUnauthorized(() => resetSession('Sessiya muddati tugadi. Iltimos, qayta kiring.'))
    return () => onUnauthorized(null)
  }, [resetSession])

  /** Serverdan kelgan ma'lumotni qo'llash (yuborilmagan mahalliy o'zgarishlar saqlanib qoladi). */
  const applyServerData = useCallback((data, revision) => {
    const prevSnapshot = snapshotRef.current
    const nextSnapshot = { ...(prevSnapshot || {}) }
    for (const key of COLLECTION_KEYS) {
      if (!Array.isArray(data?.[key])) continue
      const remote = data[key]
      const base = prevSnapshot?.[key]
      nextSnapshot[key] = remote
      setters[key]((local) => (base ? rebase(key, local, base, remote) : remote))
    }
    snapshotRef.current = nextSnapshot
    revisionRef.current = revision
    setDataLoaded(true)
    setLastSyncTime(nowTime())
  }, [setters])

  const doFetchSync = useCallback(async () => {
    if (!getToken()) return
    setIsSyncing(true)
    try {
      const { revision, data } = await fetchServerSync()
      applyServerData(data, revision)
      setSyncError('')
    } catch (error) {
      setSyncError(error.message)
    } finally {
      setIsSyncing(false)
    }
  }, [applyServerData])

  // Saqlangan token bo'lsa, foydalanuvchini tiklash
  useEffect(() => {
    if (!getToken()) return
    let cancelled = false
    fetchCurrentUser()
      .then((user) => { if (!cancelled) setAuthUser(user) })
      .catch((error) => { if (!cancelled && error.status !== 401) setLoginError(error.message) })
      .finally(() => { if (!cancelled) setAuthChecked(true) })
    return () => { cancelled = true }
  }, [])

  // Kirgandan so'ng ma'lumotlarni yuklash va jonli sinxronizatsiyani yoqish
  useEffect(() => {
    if (!authUser) return
    doFetchSync()
    return startLiveSync(() => revisionRef.current, () => doFetchSync())
  }, [authUser, doFetchSync])

  // Mahalliy o'zgarishlarni serverga yuborish (faqat o'zgargan yozuvlar)
  const latestDataRef = useRef(null)
  useEffect(() => {
    latestDataRef.current = { accounts, researchers, expertiseCases, monitoringFiles, monitoringReports, kengashFiles, postDefenseFiles, activityLog, normativeDocuments }
  })

  const collectPendingChanges = useCallback((current) => {
    const changes = {}
    if (!snapshotRef.current || !current) return changes
    for (const key of COLLECTION_KEYS) {
      const diff = computeDiff(key, snapshotRef.current[key] || [], current[key])
      if (diff) changes[key] = diff
    }
    return changes
  }, [])

  // Sahifa yopilayotganda/yangilanayotganda hali yuborilmagan o'zgarishlarni jo'natish
  useEffect(() => {
    if (!authUser || !dataLoaded) return
    const flush = () => {
      if (pushInFlight.current) return
      const changes = collectPendingChanges(latestDataRef.current)
      if (Object.keys(changes).length) flushServerChanges(changes)
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [authUser, dataLoaded, collectPendingChanges])

  useEffect(() => {
    if (!authUser || !dataLoaded) return
    const current = { accounts, researchers, expertiseCases, monitoringFiles, monitoringReports, kengashFiles, postDefenseFiles, activityLog, normativeDocuments }
    const timer = setTimeout(async () => {
      if (pushInFlight.current || !snapshotRef.current) return
      const changes = collectPendingChanges(current)
      if (!Object.keys(changes).length) return

      pushInFlight.current = true
      setIsSyncing(true)
      let succeeded = false
      try {
        const result = await pushServerChanges(changes)
        const snapshot = { ...snapshotRef.current }
        for (const key of Object.keys(changes)) snapshot[key] = applyDiff(key, snapshot[key] || [], changes[key])
        snapshotRef.current = snapshot
        const someoneElseChanged = result.previousRevision !== revisionRef.current
        revisionRef.current = result.revision
        if (someoneElseChanged || result.rejected) doFetchSync()
        setSyncError('')
        setLastSyncTime(nowTime())
        succeeded = true
      } catch (error) {
        setSyncError(`Saqlanmadi: ${error.message}`)
      } finally {
        pushInFlight.current = false
        setIsSyncing(false)
        if (succeeded) setPushTick((tick) => tick + 1)
        else setTimeout(() => setPushTick((tick) => tick + 1), 5000)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [authUser, dataLoaded, accounts, researchers, expertiseCases, monitoringFiles, monitoringReports, kengashFiles, postDefenseFiles, activityLog, normativeDocuments, pushTick, doFetchSync, collectPendingChanges])

  async function handleLogin(role, username, password) {
    setLoginError('')
    try {
      const user = await loginRequest(username.trim(), password, role)
      setAuthUser(user)
    } catch (error) {
      setLoginError(error.message)
    }
  }

  function handleLogout() {
    resetSession('')
  }

  // Tadqiqotchi profili: admin o'zgartirgan bosqich/ism darhol aks etadi
  const researcherUser = useMemo(() => {
    if (!authUser || authUser.role !== 'researcher') return authUser
    const account = accounts.find((a) => a.username === authUser.username)
    const profile = researchers.find((r) => r.username === authUser.username)
    const researcherName = account?.researcherName || profile?.name || authUser.researcherName
    return {
      ...authUser,
      researcherName,
      name: researcherName,
      stage: Number(account?.stage || profile?.stage || authUser.stage || 1),
      field: profile?.field || authUser.field,
      supervisor: profile?.supervisor || authUser.supervisor
    }
  }, [authUser, accounts, researchers])

  function logActivity(name, action) {
    setActivityLog((items) => [{ id: uid('act'), name, action, time: new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) }, ...items].slice(0, ACTIVITY_LOG_LIMIT))
  }


  const labels = {
    uz: ['Umumiy ko‘rinish', 'Izlanuvchilar', 'Monitoring', 'Hisobotlar', 'Tahlil va statistika', 'Sozlamalar', 'Ilmiy faoliyat monitoringi', 'Xayrli kun', 'Izlanuvchi qo‘shish', 'Jami izlanuvchilar', 'Reja bo‘yicha', 'Ko‘rib chiqish kerak', 'Bu chorakda topshirildi', 'Umumiy bajarilish', 'So‘nggi faollik', 'Izlanuvchilar ro‘yxati', 'Ilmiy yo‘nalish', 'Ilmiy rahbar', 'Bajarilish', 'Holati', 'Jarayonda', 'Tasdiq kutilmoqda', 'E’tibor kerak', 'Yaqin muddatlar', 'Filtr', 'Eksport', 'Barchasi'],
    ru: ['Обзор', 'Соискатели', 'Мониторинг', 'Отчёты', 'Аналитика', 'Настройки', 'Мониторинг научной деятельности', 'Добрый день', 'Добавить соискателя', 'Всего соискателей', 'По плану', 'Требуют проверки', 'Сдано в этом квартале', 'Общий прогресс', 'Последняя активность', 'Список соискателей', 'Научное направление', 'Руководитель', 'Выполнение', 'Статус', 'В процессе', 'Ожидает подтверждения', 'Требует внимания', 'Ближайшие сроки', 'Фильтр', 'Экспорт', 'Все'],
    en: ['Overview', 'Researchers', 'Monitoring', 'Reports', 'Analytics', 'Settings', 'Research activity monitoring', 'Good day', 'Add researcher', 'Total researchers', 'On track', 'Needs review', 'Submitted this quarter', 'Overall completion', 'Recent activity', 'Researchers', 'Research area', 'Supervisor', 'Progress', 'Status', 'In progress', 'Awaiting approval', 'Needs attention', 'Upcoming deadlines', 'Filter', 'Export', 'All'],
  }
  const [overview, people, plans, reports, analytics, settings, intro, , add, , , , , , , peopleList, fieldLabel, supervisorLabel, progressLabel, statusLabel, , , , , filterLabel, exportLabel, allLabel] = labels[locale] || labels.uz

  const currentTitle = {
    overview,
    people,
    plans,
    expertise: locale === 'ru' ? 'Предварительная экспертиза' : locale === 'en' ? 'Preliminary Expertise' : 'Dastlabki ekspertiza (Kafedralararo muhokama)',
    nizom: locale === 'ru' ? 'Нормы и требования' : locale === 'en' ? 'Norms and Requirements' : 'Nizom va Me’yoriy talablar',
    seminar: locale === 'ru' ? 'Научный семинар' : locale === 'en' ? 'Scientific Seminar' : 'Ilmiy seminarga',
    kengash: locale === 'ru' ? 'Разовый совет' : locale === 'en' ? 'One-time Council' : 'Bir martalik kengashga',
    post_defense: locale === 'ru' ? 'Послезащитные документы' : locale === 'en' ? 'Post-defense Documents' : 'Himoyadan keyingi hujjatlar',
    reports,
    analytics,
  }[page] || settings

  const academicYear = currentAcademicYear()

  const filtered = useMemo(() => {
    return researchers.filter((person) => {
      const textMatch = `${person.name} ${person.field} ${person.supervisor}`.toLowerCase().includes(query.toLowerCase())
      const statusMatch = filter === 'all' || filter === researcherStatus(person)
      return textMatch && statusMatch
    })
  }, [filter, query, researchers])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [totalPages, currentPage])

  const startIndex = (currentPage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const paginatedResearchers = useMemo(() => {
    return filtered.slice(startIndex, endIndex)
  }, [filtered, startIndex, endIndex])

  const paginationRange = useMemo(() => {
    return getPaginationRange(currentPage, totalPages)
  }, [currentPage, totalPages])

  const stageDetails = useMemo(() => {
    return [
      { id: 1, focus: 'Tadqiqot mavzusini aniqlash va ilmiy adabiyotlar tahlili', target: 'Tadqiqot metodologiyasi va adabiyotlar sharhini yakunlash' },
      { id: 2, focus: 'Tajriba va ma’lumotlarni yig‘ish, maqolalar tayyorlash', target: 'Ilmiy natijalarni tahlil qilish va maqolalarni chop etish' },
      { id: 3, focus: 'Natijalarni umumlashtirish va dissertatsiya himoyasi', target: 'Dissertatsiya matnini yakunlab, himoyaga tayyorlash' },
    ].map((item) => {
      const members = researchers.filter((person) => person.stage === item.id)
      const progressValues = members.map(researcherProgress).filter((value) => value !== null)
      return {
        ...item,
        count: members.length,
        progress: progressValues.length ? Math.round(progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length) : 0
      }
    })
  }, [researchers])

  const scoredResearchers = useMemo(() => {
    return researchers.map((person) => ({
      person,
      progress: researcherProgress(person),
      status: researcherStatus(person)
    }))
  }, [researchers])

  const attentionResearchers = useMemo(() => {
    return scoredResearchers.filter(({ progress }) => progress !== null && progress < 70).slice(0, 3)
  }, [scoredResearchers])

  const navItemsBefore = [
    { key: 'overview', title: overview, icon: LayoutDashboard },
    { key: 'people', title: people, icon: UsersRound, badge: researchers.length },
    { key: 'plans', title: plans, icon: ClipboardCheck },
    { key: 'expertise', title: 'Dastlabki ekspertiza', icon: ShieldCheck, badge: expertiseCases.length },
  ]

  const navItemsAfter = [
    { key: 'nizom', title: 'Nizom va Me’yorlar', icon: BookOpen },
    { key: 'analytics', title: analytics, icon: Settings2 },
  ]

  useEffect(() => {
    const syncRoute = () => setRoute(readRoute())
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  function navigateTo(nextPage, nextStage = stage) {
    const nextHash = nextPage === 'plans' ? `#plans-stage-${nextStage}` : `#${nextPage}`
    if (window.location.hash === nextHash) {
      setRoute(readRoute())
      return
    }
    window.location.hash = nextHash
  }

  function setPage(nextPage) {
    navigateTo(nextPage)
  }

  function createResearcher(event) {
    event.preventDefault()
    if (!newName.trim()) return
    const credentials = makeCredentials(newName.trim(), accounts)
    const newId = `res-${Date.now()}`
    const researcher = {
      id: newId,
      name: newName.trim(),
      initials: newName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
      color: 'blue',
      field: newField.trim() || 'Yo‘nalish belgilanmagan',
      supervisor: 'Biriktirilmagan',
      progress: 0,
      status: 'inProgress',
      due: 'Yangi profil',
      stage: Number(newStage),
      username: credentials.username
    }
    setResearchers((items) => [researcher, ...items])
    logActivity(researcher.name, 'tizimga qo‘shildi')
    setAccounts((items) => [...items, { ...credentials, researcherName: researcher.name, stage: researcher.stage, role: 'researcher' }])
    setCredentialResult([{ ...credentials, researcherName: researcher.name, stage: researcher.stage }])
    setCredentialModalOpen(true)
    setNewName('')
    setNewField('')
    setNewStage('1')
    setModalOpen(false)
  }

  function saveResearcher(event) {
    event.preventDefault()
    if (!editingResearcher) return
    const formData = new FormData(event.currentTarget)
    const excelData = Object.fromEntries(Array.from(formData.entries()).filter(([key]) => key !== '__stage'))
    const readColumn = (aliases) => {
      const entry = Object.entries(excelData).find(([key]) => aliases.includes(normalizeHeader(key)))
      return String(entry?.[1] ?? '').trim()
    }
    const name = readColumn(['fio', 'fish', 'fullname', 'name', 'izlanuvchi', 'familiyasiismivaotasiningismi', 'familiyasiismiotasiningismi']) || editingResearcher.name
    const field = readColumn(['ilmiyyonalish', 'ilmiyyunalish', 'mavzularinomlanishi', 'mavzunomlanishi', 'mavzu', 'tadqiqotmavzusi']) || editingResearcher.field
    const supervisor = readColumn(['ilmiyrahbar', 'ilmiyrahbarifish', 'rahbarifish', 'rahbar']) || editingResearcher.supervisor
    const admissionOrder = readColumn(['qabulqilingansanavabuyruq', 'qabulbuyrugi']) || editingResearcher.admissionOrder
    const stageVal = stageFromAdmissionYear(admissionOrder) || Number(formData.get('__stage') || editingResearcher.stage)
    const updated = { ...editingResearcher, name, field, supervisor, admissionOrder, stage: stageVal, excelData }

    // Cascade updates across all related stores
    setResearchers((items) => items.map((person) => (person.id === editingResearcher.id || person.username === editingResearcher.username) ? updated : person))
    setAccounts((items) => items.map((acc) => (acc.username === editingResearcher.username || acc.researcherName === editingResearcher.name) ? { ...acc, researcherName: name, stage: stageVal } : acc))
    setExpertiseCases((items) => items.map((c) => c.researcherName === editingResearcher.name ? { ...c, researcherName: name, field, supervisor } : c))
    setMonitoringReports((items) => items.map((r) => r.username === editingResearcher.username ? { ...r, fio: name, stage: String(stageVal) } : r))
    setPostDefenseFiles((items) => items.map((f) => f.username === editingResearcher.username ? { ...f, researcherName: name } : f))

    logActivity(name, 'profil ma’lumotlari yangilandi')
    setSelectedResearcher(updated)
    setEditingResearcher(null)
  }

  function deleteResearcher(researcher) {
    if (!window.confirm(`${researcher.name} ma’lumotlarini o‘chirishni tasdiqlaysizmi? Unga tegishli barcha modullardagi yozuvlar ham tozalanadi.`)) return
    const uname = researcher.username
    const rname = researcher.name

    // Cascade deletion across all stores to eliminate orphaned records
    setResearchers((items) => items.filter((person) => person.id !== researcher.id && person.username !== uname))
    setAccounts((items) => items.filter((acc) => acc.username !== uname && acc.researcherName !== rname))
    setExpertiseCases((items) => items.filter((c) => c.researcherName !== rname))
    setMonitoringFiles((items) => items.filter((f) => f.username !== uname))
    setMonitoringReports((items) => items.filter((r) => r.username !== uname && r.fio !== rname))
    setKengashFiles((items) => items.filter((f) => f.username !== uname))
    setPostDefenseFiles((items) => items.filter((f) => f.username !== uname))

    logActivity(rname, 'tizimdan o‘chirildi')
    setSelectedResearcher(null)
    setEditingResearcher(null)
  }

  function regenerateAllPasswords() {
    const researcherAccounts = accounts.filter((a) => a.role === 'researcher' || a.researcherName)
    if (!researcherAccounts.length) {
      alert('Tizimda izlanuvchi hisoblari mavjud emas.')
      return
    }
    if (!window.confirm(`Barcha ${researcherAccounts.length} ta izlanuvchi uchun yangi parollar yaratilsinmi? Eski parollar ishlamay qoladi, yangilarini izlanuvchilarga qayta tarqatishingiz kerak bo‘ladi.`)) return
    const updated = new Map()
    for (const account of researcherAccounts) {
      updated.set(account.username, { ...account, password: makeCredentials(account.username, []).password })
    }
    setAccounts((items) => items.map((a) => updated.get(a.username) || a))
    setCredentialResult([...updated.values()])
    setCredentialModalOpen(true)
    logActivity('Administrator', `Barcha izlanuvchilar parollari yangilandi (${updated.size} ta)`)
  }

  async function handleBackupDownload() {
    try {
      await downloadBackup()
    } catch (error) {
      alert(error.message)
    }
  }

  async function handleRestoreFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const data = JSON.parse(await file.text())
      if (!window.confirm('Joriy baza zaxira nusxadagi ma’lumotlar bilan to‘liq almashtiriladi. Davom etasizmi?')) return
      await restoreBackup(data)
      snapshotRef.current = null
      await doFetchSync()
      alert('Baza zaxira nusxadan muvaffaqiyatli tiklandi.')
    } catch (error) {
      alert(`Zaxirani tiklab bo‘lmadi: ${error.message}`)
    }
  }

  async function uploadNormativeDocuments(event) {
    const selected = Array.from(event.target.files || [])
    const accepted = selected.filter((file) => /\.(pdf|doc|docx)$/i.test(file.name) && file.size <= 30 * 1024 * 1024)
    const rejected = selected.filter((file) => !accepted.includes(file))
    if (rejected.length) {
      setNormativeError(rejected.map((file) => `${file.name}: PDF, DOC, DOCX va 30 MB gacha bo‘lgan fayllar qabul qilinadi.`).join(' '))
    } else {
      setNormativeError('')
    }

    for (const file of accepted) {
      try {
        const uploadRes = await uploadRealFile(file, 'Normativ hujjatlar')
        const newDoc = {
          id: uid('norm'),
          name: file.name,
          size: file.size,
          fileUrl: uploadRes.fileUrl,
          uploadedAt: new Date().toISOString()
        }
        setNormativeDocuments((items) => [newDoc, ...items])
        logActivity('Administrator', `Normativ hujjat yuklandi: ${file.name}`)
      } catch (err) {
        setNormativeError('Fayl yuklashda xatolik: ' + err.message)
      }
    }
    event.target.value = ''
  }

  async function importResearchers(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setImportError('')
    try {
      if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Faqat .xlsx formatidagi Excel faylni tanlang.')
      const workbook = await readXlsxFile(file)
      const rows = workbook[0]?.data || []
      const headerRowIndex = rows.findIndex((row) => row.some((value) => String(value ?? '').trim()))
      if (headerRowIndex < 0) throw new Error('Excel faylda sarlavha qatori topilmadi.')
      const headers = rows[headerRowIndex].map(normalizeHeader)
      const columns = {
        name: ['fio', 'fish', 'fullname', 'name', 'izlanuvchi', 'izlanuvchifish', 'familiyasiismivaotasiningismi', 'familiyasiismiotasiningismi', 'тўлиқисм', 'фиш'],
        field: ['ilmiyyonalish', 'ilmiyyunalish', 'ilmiyyonalishi', 'yunalish', 'yonalish', 'tadqiqotmavzusi', 'ilmiyishmavzusi', 'mavzu', 'mavzularinomlanishi', 'mavzularnomlanishi', 'mavzunomlanishi', 'researcharea', 'topic', 'йуналиш', 'мавзу'],
        supervisor: ['ilmiyrahbar', 'ilmiyrahbarifish', 'rahbarifish', 'rahbar', 'supervisor', 'advisor', 'раҳбар'],
        stage: ['bosqich', 'bosqichraqami', 'talimbosqichi', 'oqishbosqichi', 'kurs', 'stage', 'studyyear', 'босқич'],
        educationType: ['talimturi', 'educationtype'],
        specialtyCode: ['ixtisoslikshifri', 'ixtisoslikkodi', 'specialtycode'],
        councilDecision: ['universitetkengashqarori', 'kengashqarori'],
        admissionOrder: ['qabulqilingansanavabuyruq', 'qabulbuyrugi'],
        workplace: ['ishjoyi', 'workplace'],
        position: ['lavozimi', 'lavozim', 'position'],
        department: ['biriktirilgankafedrasi', 'kafedra', 'department'],
        monitoring2025: ['monitoring2025'],
        monitoring2026: ['monitoring2026'],
        phone: ['telraqami', 'telefonraqami', 'telefon', 'phone'],
      }
      const indexes = Object.fromEntries(Object.entries(columns).map(([key, aliases]) => [key, headers.findIndex((header) => aliases.includes(header))]))
      if (indexes.name < 0) throw new Error('F.I.Sh, To‘liq ism yoki Name ustuni topilmadi.')
      const newResearchers = []
      const newAccounts = []
      const knownResearchers = new Set(researchers.map((person) => normalizeHeader(person.name)))
      let skippedDuplicates = 0
      for (const row of rows.slice(headerRowIndex + 1)) {
        const name = String(row[indexes.name] ?? '').trim()
        const normalizedName = normalizeHeader(name)
        if (!name) continue
        if (knownResearchers.has(normalizedName)) {
          skippedDuplicates += 1
          continue
        }
        knownResearchers.add(normalizedName)
        const stageText = indexes.stage >= 0 ? String(row[indexes.stage] ?? '') : ''
        const parsedStage = Number(stageText.match(/(?:^|\D)([123])(?:\s*[-.]?\s*(?:bosqich|kurs|yil)|\s*$)/i)?.[1] || 0)
        const admissionOrder = indexes.admissionOrder >= 0 ? row[indexes.admissionOrder] : ''
        const stageValue = parsedStage ? Math.min(3, Math.max(1, parsedStage)) : stageFromAdmissionYear(admissionOrder) || 1
        const credentials = makeCredentials(name, [...accounts, ...newAccounts])
        const excelData = Object.fromEntries(rows[headerRowIndex].map((header, columnIndex) => [String(header ?? '').trim(), row[columnIndex] ?? '']))
        const importedProgress = researcherProgress({ excelData })
        const researcher = {
          id: `res-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          name,
          initials: name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
          color: 'blue',
          field: indexes.field >= 0 ? String(row[indexes.field] ?? '').trim() || 'Yo‘nalish belgilanmagan' : 'Yo‘nalish belgilanmagan',
          supervisor: indexes.supervisor >= 0 ? String(row[indexes.supervisor] ?? '').trim() || 'Biriktirilmagan' : 'Biriktirilmagan',
          educationType: indexes.educationType >= 0 ? String(row[indexes.educationType] ?? '').trim() : '',
          specialtyCode: indexes.specialtyCode >= 0 ? String(row[indexes.specialtyCode] ?? '').trim() : '',
          workplace: indexes.workplace >= 0 ? String(row[indexes.workplace] ?? '').trim() : '',
          position: indexes.position >= 0 ? String(row[indexes.position] ?? '').trim() : '',
          department: indexes.department >= 0 ? String(row[indexes.department] ?? '').trim() : '',
          admissionOrder: String(admissionOrder ?? '').trim(),
          monitoring2025: indexes.monitoring2025 >= 0 ? String(row[indexes.monitoring2025] ?? '').trim() : '',
          monitoring2026: indexes.monitoring2026 >= 0 ? String(row[indexes.monitoring2026] ?? '').trim() : '',
          phone: indexes.phone >= 0 ? String(row[indexes.phone] ?? '').trim() : '',
          excelData,
          progress: importedProgress,
          status: 'inProgress',
          due: 'Yangi profil',
          stage: stageValue,
          username: credentials.username,
        }
        newResearchers.push(researcher)
        newAccounts.push({ ...credentials, researcherName: name, stage: stageValue, role: 'researcher' })
      }
      if (!newResearchers.length) throw new Error(skippedDuplicates ? 'Ushbu fayldagi barcha izlanuvchilar avval import qilingan.' : 'Import qilish uchun ism ko‘rsatilgan qator topilmadi.')
      setResearchers((items) => [...newResearchers, ...items])
      newResearchers.forEach((person) => logActivity(person.name, 'Excel orqali import qilindi'))
      setAccounts((items) => [...items, ...newAccounts])
      setCredentialResult(newAccounts)
      setCredentialModalOpen(true)
    } catch (error) {
      setImportError(error.message || 'Faylni o‘qishda xatolik yuz berdi.')
    } finally {
      event.target.value = ''
    }
  }

  async function exportCredentialsToExcel(customList = null) {
    const listToExport = (Array.isArray(customList) && customList.length > 0)
      ? customList
      : (credentialResult && credentialResult.length > 0)
        ? credentialResult
        : accounts.filter(a => a.role === 'researcher' || a.researcherName);

    if (!listToExport || listToExport.length === 0) {
      alert(locale === 'ru' ? 'Нет доступных аккаунтов соискателей для экспорта.' : locale === 'en' ? 'No researcher accounts available to export.' : 'Yuklab olish uchun izlanuvchilar akkauntlari mavjud emas.');
      return;
    }

    const headerRow = [
      { value: '№', fontWeight: 'bold', align: 'center', backgroundColor: '#e2e8f0' },
      { value: 'F.I.Sh (Izlanuvchi)', fontWeight: 'bold', backgroundColor: '#e2e8f0' },
      { value: 'Bosqich', fontWeight: 'bold', align: 'center', backgroundColor: '#e2e8f0' },
      { value: 'Tizim Logini', fontWeight: 'bold', backgroundColor: '#e2e8f0' },
      { value: 'Parol', fontWeight: 'bold', backgroundColor: '#e2e8f0' },
      { value: 'Kafedra', fontWeight: 'bold', backgroundColor: '#e2e8f0' },
      { value: 'Ilmiy rahbar', fontWeight: 'bold', backgroundColor: '#e2e8f0' }
    ];

    const dataRows = listToExport.map((item, idx) => {
      const res = researchers.find(r => r.username === item.username || r.name === item.researcherName);
      return [
        { value: idx + 1, align: 'center' },
        { value: String(item.researcherName || item.name || res?.name || '').trim() },
        { value: `${item.stage || res?.stage || 1}-bosqich`, align: 'center' },
        { value: String(item.username || '').trim() },
        { value: String(item.password || '').trim() },
        { value: String(res?.department || item.department || 'Biriktirilmagan').trim() },
        { value: String(res?.supervisor || item.supervisor || 'Biriktirilmagan').trim() }
      ];
    });

    const sheetData = [headerRow, ...dataRows];
    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = `izlanuvchilar-login-parollari-${timestamp}.xlsx`;

    try {
      await writeXlsxFile(sheetData, {
        fileName,
        columns: [
          { width: 6 },
          { width: 36 },
          { width: 14 },
          { width: 22 },
          { width: 22 },
          { width: 32 },
          { width: 30 }
        ]
      }).toFile(fileName);
    } catch (err) {
      console.error('Excel yozishda xatolik:', err);
      try {
        const fallbackRows = [
          ['№', 'F.I.Sh', 'Bosqich', 'Login', 'Parol', 'Kafedra', 'Ilmiy rahbar'],
          ...listToExport.map((item, idx) => {
            const res = researchers.find(r => r.username === item.username || r.name === item.researcherName);
            return [
              idx + 1,
              String(item.researcherName || item.name || res?.name || ''),
              `${item.stage || res?.stage || 1}-bosqich`,
              String(item.username || ''),
              String(item.password || ''),
              String(res?.department || item.department || ''),
              String(res?.supervisor || item.supervisor || '')
            ];
          })
        ];
        const blob = await writeXlsxFile(fallbackRows).toBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (fallbackErr) {
        alert('Excel faylni saqlashda xatolik yuz berdi: ' + (err.message || fallbackErr.message));
        return;
      }
    }
    logActivity('Administrator', `Izlanuvchilar login va parollari Excel fayl shaklida yuklab olindi (${listToExport.length} ta)`);
  }

  // Backward compatibility alias
  const saveCredentials = exportCredentialsToExcel;

  if (!authChecked) {
    return <LoadingScreen text="Tizimga ulanilmoqda..." />
  }

  if (!authUser) {
    return <UnifiedLogin onLogin={handleLogin} error={loginError} locale={locale} />
  }

  if (!dataLoaded) {
    return <LoadingScreen text={syncError ? `Ma’lumotlarni yuklab bo‘lmadi: ${syncError}` : 'Ma’lumotlar yuklanmoqda...'} onRetry={syncError ? doFetchSync : null} onLogout={handleLogout} />
  }

  if (authUser.role === 'researcher') {
    return <ResearcherWorkspace user={researcherUser} normativeDocuments={normativeDocuments} expertiseCases={expertiseCases} setExpertiseCases={setExpertiseCases} onLogout={handleLogout} monitoringFiles={monitoringFiles} setMonitoringFiles={setMonitoringFiles} monitoringReports={monitoringReports} setMonitoringReports={setMonitoringReports} kengashFiles={kengashFiles} setKengashFiles={setKengashFiles} postDefenseFiles={postDefenseFiles} setPostDefenseFiles={setPostDefenseFiles} theme={theme} setTheme={setTheme} locale={locale} setLocale={setLocale} isOnline={isOnline} lastSyncTime={lastSyncTime} isSyncing={isSyncing} syncError={syncError} doFetchSync={doFetchSync} />
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
      <BrandMark locale={locale} variant="sidebar" onClick={() => { setPage('overview'); setMobileNavOpen(false) }} />
      <div className="workspace-label">{locale === 'ru' ? 'Научная деятельность' : locale === 'en' ? 'Research activity' : 'Ilmiy faoliyat'}</div>

      <nav className="side-nav" aria-label="Asosiy navigatsiya">
        {navItemsBefore.map(({ key, title, icon: Icon, badge }) => <button key={key} type="button" className={`nav-item ${page === key ? 'nav-active' : ''}`} onClick={() => { setPage(key); setMobileNavOpen(false) }}><Icon size={18} /><span>{title}</span>{badge ? <i className="nav-count">{badge}</i> : null}</button>)}
        <div className="nav-dropdown">
          <button type="button" className={`nav-item ${(page === 'seminar' || page === 'kengash') ? 'nav-active' : ''}`} onClick={() => setSeminarMenuOpen(!seminarMenuOpen)}>
            <UsersRound size={18} />
            <span style={{flex: 1, textAlign: 'left', whiteSpace: 'normal', lineHeight: '1.2'}}>{locale === 'ru' ? 'Научный семинар / совет' : locale === 'en' ? 'Scientific Seminar / Council' : 'Ilmiy seminarga / kengashga'}</span>
            <ChevronDown size={16} style={{ transform: seminarMenuOpen ? 'rotate(180deg)' : 'none', transition: '0.2s', flexShrink: 0 }} />
          </button>
          {seminarMenuOpen && (
            <div className="nav-submenu" style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '4px 8px 4px 36px' }}>
              <button type="button" className={`nav-item ${page === 'seminar' ? 'nav-active' : ''}`} onClick={() => { setPage('seminar'); setMobileNavOpen(false) }} style={{ padding: '8px 12px', fontSize: '13px', minHeight: 'auto' }}>
                <span style={{ width: '5px', height: '5px', background: 'currentColor', borderRadius: '50%', marginRight: '8px', opacity: 0.6 }}></span> {locale === 'ru' ? 'Научный семинар' : locale === 'en' ? 'Scientific Seminar' : 'Ilmiy seminarga'}
              </button>
              <button type="button" className={`nav-item ${page === 'kengash' ? 'nav-active' : ''}`} onClick={() => { setPage('kengash'); setMobileNavOpen(false) }} style={{ padding: '8px 12px', fontSize: '13px', minHeight: 'auto' }}>
                <span style={{ width: '5px', height: '5px', background: 'currentColor', borderRadius: '50%', marginRight: '8px', opacity: 0.6 }}></span> {locale === 'ru' ? 'Разовый совет' : locale === 'en' ? 'One-time Council' : 'Bir martalik kengashga'}
              </button>
            </div>
          )}
        </div>
        <button type="button" className={`nav-item ${page === 'post_defense' ? 'nav-active' : ''}`} onClick={() => { setPage('post_defense'); setMobileNavOpen(false) }}>
          <FileCheck size={18} />
          <span>{locale === 'ru' ? 'Послезащитные документы' : locale === 'en' ? 'Post-defense documents' : 'Himoyadan keyingi hujjatlar'}</span>
          {postDefenseFiles.filter(f => f.status === 'Kutilmoqda').length > 0 && (
            <i className="nav-count">{postDefenseFiles.filter(f => f.status === 'Kutilmoqda').length}</i>
          )}
        </button>
        {navItemsAfter.map(({ key, title, icon: Icon, badge }) => <button key={key} type="button" className={`nav-item ${page === key ? 'nav-active' : ''}`} onClick={() => { setPage(key); setMobileNavOpen(false) }}><Icon size={18} /><span>{title}</span>{badge ? <i className="nav-count">{badge}</i> : null}</button>)}
      </nav>
      <div className="sidebar-bottom"><button className="nav-item settings-item" onClick={() => setPage('settings')}><Settings2 size={18} /><span>{settings}</span></button><button className="profile-button" onClick={handleLogout}><span className="avatar avatar-admin">A</span><span className="profile-info"><strong>{locale === 'ru' ? 'Администратор' : locale === 'en' ? 'Administrator' : 'Administrator'}</strong><small>{locale === 'ru' ? 'Выход' : locale === 'en' ? 'Logout' : 'Tizimdan chiqish'}</small></span><LogOut size={15} /></button></div>
    </aside>
    {mobileNavOpen && <button className="nav-scrim" aria-label="Menyuni yopish" onClick={() => setMobileNavOpen(false)} />}
    <main className="main-area">
      <header className="topbar">
        <button className="mobile-menu icon-button" aria-label="Menyuni ochish" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
        <div className="breadcrumb"><span>{locale === 'ru' ? 'Научная деятельность' : locale === 'en' ? 'Research Activity' : 'Ilmiy faoliyat'}</span><ChevronRight size={14} /><strong>{currentTitle}</strong></div>
        <div className="topbar-actions">
          <SyncIndicator isOnline={isOnline} isSyncing={isSyncing} syncError={syncError} lastSyncTime={lastSyncTime} onSync={doFetchSync} />
          <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); if (page !== 'people') setPage('people') }} placeholder={locale === 'en' ? 'Search researchers or topics' : locale === 'ru' ? 'Поиск по соискателю или теме' : 'Izlanuvchi yoki mavzu bo‘yicha qidirish'} /></label>
          <div className="locale-picker" aria-label="Interfeys tili">{['uz', 'ru', 'en'].map((language) => <button key={language} className={locale === language ? 'locale-active' : ''} onClick={() => setLocale(language)}>{language.toUpperCase()}</button>)}</div>
          <div className="notification-wrap"><button className="icon-button notification-button" aria-label="Bildirishnomalar" onClick={() => setNotificationsOpen((open) => !open)}><Bell size={19} />{attentionResearchers.length > 0 && <i />}</button>{notificationsOpen && <div className="notification-popover"><strong>Monitoring ogohlantirishlari</strong>{attentionResearchers.length ? attentionResearchers.map(({ person, progress }) => <p key={person.username || person.name}><CircleAlert size={16} /> {person.name} · {progress}% bajarilgan</p>) : <p>Excel ma’lumotlarida e’tibor talab qiladigan holat topilmadi.</p>}</div>}</div>
          <button className="avatar avatar-admin top-avatar" aria-label="Profil" title="Administrator" onClick={() => setPage('settings')}>A</button>
        </div>
      </header>
      <div className={`page-content ${page === 'overview' ? 'dashboard-page' : 'module-page-content'}`}>
        {credentialModalOpen && <CredentialDialog entries={credentialResult} onClose={() => setCredentialModalOpen(false)} onExport={saveCredentials} onLogin={() => { setCredentialModalOpen(false); navigateTo('login') }} locale={locale} />}
        {page !== 'overview' && (
          <section className="page-heading">
            <div>
              <div className="eyebrow"><i className="live-dot" /> {academicYear} o‘quv yili · Tizim integratsiyasi to‘liq faol</div>
              <h1>{currentTitle}</h1>
              <p>{intro}</p>
            </div>
            <div className="heading-actions">
              <button className="secondary-button" onClick={() => window.print()}><ArrowDownToLine size={16} />{exportLabel}</button>
              {page === 'people' && <button className="primary-button" onClick={() => setModalOpen(true)}><Plus size={17} />{add}</button>}
            </div>
          </section>
        )}
        {page === 'people' && (
          <section className="import-toolbar">
            <div>
              <span className="import-icon"><Sheet size={17} /></span>
              <span>
                <strong>{locale === 'ru' ? 'Импорт из Excel' : locale === 'en' ? 'Import from Excel' : 'Excel fayldan import'}</strong>
                <small>
                  {locale === 'ru'
                    ? 'При импорте соискателей автоматически генерируются логины и пароли. Вы можете скачать их файлом Excel.'
                    : locale === 'en'
                    ? 'When importing researchers, logins and passwords are automatically generated. You can download them as an Excel file.'
                    : 'Monitoring va hisobotlar import qilingan Excel qiymatlaridan jonli hisoblanadi. Hosil bo‘lgan login va parollarni Excel fayl shaklida yuklab olishingiz mumkin.'}
                </small>
              </span>
            </div>
            <input ref={importInputRef} className="visually-hidden" type="file" accept=".xlsx" onChange={importResearchers} />
            <div className="import-actions">
              <button className="secondary-button" onClick={() => importInputRef.current?.click()}>
                <Upload size={15} />{locale === 'ru' ? 'Импорт Excel' : locale === 'en' ? 'Excel Import' : 'Excel import'}
              </button>
              <button
                className="secondary-button"
                onClick={() => exportCredentialsToExcel()}
                title="Barcha yoki yangi import qilingan izlanuvchilar login va parollarini Excel (.xlsx) shaklida yuklab olish"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <ArrowDownToLine size={15} />
                {locale === 'ru' ? 'Скачать логины и пароли (.xlsx)' : locale === 'en' ? 'Export Logins & Passwords (.xlsx)' : 'Login va parollarni yuklab olish (.xlsx)'}
              </button>
              <button className="text-link" onClick={() => navigateTo('login')}>
                <LockKeyhole size={14} />{locale === 'ru' ? 'Вход для соискателей' : locale === 'en' ? 'Researcher Login' : 'Izlanuvchi kirishi'}
              </button>
            </div>
            {importError && <p className="import-error"><CircleAlert size={14} />{importError}</p>}
          </section>
        )}

        {page === 'overview' && (
          <ExecutiveDashboard
            researchers={researchers}
            stageDetails={stageDetails}
            monitoringFiles={monitoringFiles}
            monitoringReports={monitoringReports}
            expertiseCases={expertiseCases}
            kengashFiles={kengashFiles}
            postDefenseFiles={postDefenseFiles}
            activityLog={activityLog}
            academicYear={academicYear}
            locale={locale}
            navigateTo={navigateTo}
            setSelectedResearcher={setSelectedResearcher}
            setModalOpen={setModalOpen}
            importInputRef={importInputRef}
            onExportCredentials={() => exportCredentialsToExcel()}
          />
        )}
        {page === 'people' && (
          <section className="module-view panel">
            <div className="module-toolbar">
              <div>
                <span className="section-kicker">{locale === 'ru' ? 'БАЗА СОИСКАТЕЛЕЙ' : locale === 'en' ? 'RESEARCHER DATABASE' : 'TADQIQOTCHILAR BAZASI'}</span>
                <h2>{peopleList}</h2>
                <p>
                  {locale === 'ru'
                    ? `Всего соискателей: ${filtered.length} (на странице: ${paginatedResearchers.length})`
                    : locale === 'en'
                    ? `Total researchers: ${filtered.length} (on page: ${paginatedResearchers.length})`
                    : `Jami ${filtered.length} ta izlanuvchi (ushbu sahifada: ${paginatedResearchers.length} ta)`}
                </p>
              </div>
              <div style={{ position: 'relative' }}>
                <button className="filter-button" onClick={() => setFilterOpen((open) => !open)}>
                  <Settings2 size={15} />{filterLabel}
                </button>
                {filterOpen && (
                  <div className="filter-popover" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30, background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px', boxShadow: '0 4px 14px rgba(0,0,0,0.12)', minWidth: 160, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button type="button" style={{ padding: '6px 10px', textAlign: 'left', background: filter === 'all' ? '#eff6ff' : 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }} onClick={() => { setFilter('all'); setFilterOpen(false); }}>{allLabel} ({researchers.length})</button>
                    <button type="button" style={{ padding: '6px 10px', textAlign: 'left', background: filter === 'inProgress' ? '#eff6ff' : 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }} onClick={() => { setFilter('inProgress'); setFilterOpen(false); }}>Reja bo‘yicha</button>
                    <button type="button" style={{ padding: '6px 10px', textAlign: 'left', background: filter === 'needsReview' ? '#eff6ff' : 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }} onClick={() => { setFilter('needsReview'); setFilterOpen(false); }}>Ko‘rib chiqish kerak</button>
                    <button type="button" style={{ padding: '6px 10px', textAlign: 'left', background: filter === 'atRisk' ? '#eff6ff' : 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }} onClick={() => { setFilter('atRisk'); setFilterOpen(false); }}>E’tibor kerak</button>
                  </div>
                )}
              </div>
            </div>

            {/* Ro'yxat tepasida chap burchakda qatorlar sonini belgilash imkoniyati */}
            <div className="table-header-bar">
              <div className="page-size-picker">
                <span className="page-size-text">
                  {locale === 'ru' ? 'Показывать строк:' : locale === 'en' ? 'Rows per page:' : 'Qatorlar soni:'}
                </span>
                <select
                  className="page-size-select"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setCurrentPage(1)
                  }}
                  aria-label={locale === 'ru' ? 'Количество строк' : locale === 'en' ? 'Rows count' : 'Qatorlar sonini tanlash'}
                >
                  <option value={10}>10 ta</option>
                  <option value={30}>30 ta</option>
                  <option value={60}>60 ta</option>
                  <option value={100}>100 ta</option>
                </select>
              </div>
              <div className="table-range-info">
                {filtered.length > 0 && (
                  <span>
                    {locale === 'ru'
                      ? `Показано ${startIndex + 1}–${Math.min(endIndex, filtered.length)} из ${filtered.length}`
                      : locale === 'en'
                      ? `Showing ${startIndex + 1}–${Math.min(endIndex, filtered.length)} of ${filtered.length}`
                      : `${filtered.length} tadan ${startIndex + 1}–${Math.min(endIndex, filtered.length)} ko‘rsatilmoqda`}
                  </span>
                )}
              </div>
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{people}</th>
                    <th>{fieldLabel}</th>
                    <th>{supervisorLabel}</th>
                    <th>{locale === 'ru' ? 'Этап' : locale === 'en' ? 'Stage' : 'Bosqich'}</th>
                    <th>{progressLabel}</th>
                    <th>{statusLabel}</th>
                    <th>{locale === 'ru' ? 'Данные Excel' : locale === 'en' ? 'Excel data' : 'Excel ma’lumotlari'}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedResearchers.map((person) => (
                    <tr key={person.username || person.name}>
                      <td>
                        <div className="researcher-cell">
                          <span className={`avatar avatar-${person.color}`}>{person.initials}</span>
                          <span>
                            <strong>{person.name}</strong>
                            <small>{person.educationType || 'Izlanuvchi'}</small>
                          </span>
                        </div>
                      </td>
                      <td>{person.field}</td>
                      <td>{person.supervisor}</td>
                      <td>{person.stage}-bosqich</td>
                      <td><ResearcherProgress researcher={person} /></td>
                      <td><ResearcherStatus researcher={person} locale={locale} /></td>
                      <td>
                        <button
                          className="icon-button details-button"
                          aria-label={`${person.name} ma’lumotlarini ko‘rish`}
                          onClick={() => setSelectedResearcher(person)}
                        >
                          <Eye size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="empty-state">
                  Izlanuvchilar ro‘yxati bo‘sh. Excel fayl import qiling yoki "Izlanuvchi qo‘shish" tugmasini bosing.
                </div>
              )}
            </div>

            {/* Pastda keyingi qatorlarga o'tish uchun pagination: 1, 2, 3, 4, 5... */}
            {filtered.length > 0 && (
              <div className="table-pagination-footer">
                <div className="pagination-info">
                  {locale === 'ru'
                    ? `Страница ${currentPage} из ${totalPages}`
                    : locale === 'en'
                    ? `Page ${currentPage} of ${totalPages}`
                    : `${currentPage} / ${totalPages}-sahifa`}
                </div>
                <div className="pagination-controls">
                  <button
                    type="button"
                    className="pagination-btn pagination-nav-btn"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    title={locale === 'ru' ? 'Предыдущая страница' : locale === 'en' ? 'Previous page' : 'Oldingi sahifa'}
                  >
                    <ChevronLeft size={16} />
                    <span>{locale === 'ru' ? 'Назад' : locale === 'en' ? 'Prev' : 'Oldingi'}</span>
                  </button>

                  <div className="pagination-pages">
                    {paginationRange.map((item, idx) => {
                      if (item === '...') {
                        return <span key={`dots-${idx}`} className="pagination-dots">...</span>
                      }
                      return (
                        <button
                          key={`page-${item}`}
                          type="button"
                          className={`pagination-btn pagination-page-btn ${currentPage === item ? 'active' : ''}`}
                          onClick={() => setCurrentPage(item)}
                        >
                          {item}
                        </button>
                      )
                    })}
                  </div>

                  <button
                    type="button"
                    className="pagination-btn pagination-nav-btn"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    title={locale === 'ru' ? 'Следующая страница' : locale === 'en' ? 'Next page' : 'Keyingi sahifa'}
                  >
                    <span>{locale === 'ru' ? 'Вперед' : locale === 'en' ? 'Next' : 'Keyingi'}</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {selectedResearcher && <ResearcherDetails researcher={selectedResearcher} accounts={accounts} onClose={() => setSelectedResearcher(null)} onEdit={() => { setEditingResearcher(selectedResearcher); setSelectedResearcher(null) }} onDelete={() => deleteResearcher(selectedResearcher)} locale={locale} navigateTo={navigateTo} />}
        {editingResearcher && <ResearcherEditDialog researcher={editingResearcher} onClose={() => setEditingResearcher(null)} onSave={saveResearcher} locale={locale} />}

        {page === 'plans' && <AdminMonitoringView key={`plans-${stage}`} files={monitoringFiles} reports={monitoringReports} setReports={setMonitoringReports} researchers={researchers} selectedStage={stage} locale={locale} />}
        {page === 'seminar' && <div className="portal-content" style={{padding: '20px'}}><KengashAdminView kengashFiles={kengashFiles} setKengashFiles={setKengashFiles} researchers={researchers} isSeminar={true} locale={locale} /></div>}
        {page === 'kengash' && <div className="portal-content" style={{padding: '20px'}}><KengashAdminView kengashFiles={kengashFiles} setKengashFiles={setKengashFiles} researchers={researchers} locale={locale} /></div>}
        {page === 'post_defense' && <div className="portal-content" style={{padding: '20px'}}><PostDefenseAdminView postDefenseFiles={postDefenseFiles} setPostDefenseFiles={setPostDefenseFiles} researchers={researchers} locale={locale} /></div>}

        {page === 'analytics' && <section className="module-view analytics-view"><div className="analytics-heading"><span className="section-kicker">{locale === 'ru' ? 'ЗА 3 ГОДА' : locale === 'en' ? 'OVER 3 YEARS' : '3 YILLIK KESIMDA'}</span><h2>{locale === 'ru' ? 'Показатели по этапам' : locale === 'en' ? 'Metrics by stages' : 'Bosqichlar bo‘yicha ko‘rsatkichlar'}</h2><p>{locale === 'ru' ? 'Выполнение индивидуальных планов соискателями' : locale === 'en' ? 'Fulfillment of individual plans by researchers' : 'Izlanuvchilarning individual rejalar bajarilishi'}</p></div><div className="analytics-stage-grid">{stageDetails.map((item) => <button key={item.id} className="panel analytics-stage" onClick={() => navigateTo('plans', item.id)}><span className="analytics-stage-top"><span>{item.id}-{locale === 'ru' ? 'этап' : locale === 'en' ? 'stage' : 'bosqich'}</span><ArrowUpRight size={16} /></span><strong>{item.progress}%</strong><span className="analytics-stage-bar"><i style={{ width: `${item.progress}%` }} /></span><small>{item.count} {locale === 'ru' ? 'соискателей · среднее выполнение' : locale === 'en' ? 'researchers · average completion' : 'nafar izlanuvchi · rejalar o‘rtacha bajarilishi'}</small><span className="analytics-stage-focus">{item.focus}</span></button>)}</div></section>}

        {page === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <section className="module-view panel settings-view">
              <span className="section-kicker">{locale === 'ru' ? 'УПРАВЛЕНИЕ СИСТЕМОЙ' : locale === 'en' ? 'SYSTEM MANAGEMENT' : 'TIZIM BOSHQARUVI'}</span>
              <h2>{settings}</h2>
              <p>{locale === 'ru' ? 'Настройки факультета и отдела' : locale === 'en' ? 'Faculty and Department Settings' : 'Fakultet va bo‘lim sozlamalari'}</p>
              
              <div className="settings-row">
                <span><strong>{locale === 'ru' ? 'Университет' : locale === 'en' ? 'University' : 'Universitet'}</strong><small>{locale === 'ru' ? 'Название организации в системе' : locale === 'en' ? 'Organization name displayed in the system' : 'Tizimda ko‘rsatiladigan tashkilot nomi'}</small></span>
                <input defaultValue="Jamoat Xavfsizligi Universiteti" />
              </div>

              <div className="settings-row">
                <span><strong>{locale === 'ru' ? 'Напоминание о сдаче отчета' : locale === 'en' ? 'Report submission reminder' : 'Hisobot topshirish eslatmasi'}</strong><small>{locale === 'ru' ? 'За сколько дней до срока отправить предупреждение' : locale === 'en' ? 'Days before deadline to send warning' : 'Muddat tugashidan necha kun oldin ogohlantirish yuborilsin'}</small></span>
                <select defaultValue="10"><option value="5">5 kun oldin</option><option value="10">10 kun oldin</option><option value="14">14 kun oldin</option></select>
              </div>

              <div className="settings-row">
                <span><strong>Mavzu (Theme)</strong><small>Tizim ko'rinishi (Kunduzgi yoki Kechki)</small></span>
                <select value={theme} onChange={(e) => setTheme(e.target.value)}><option value="light">Kunduzgi (Light)</option><option value="dark">Kechki (Dark Neon)</option></select>
              </div>

              <div className="settings-row" style={{borderTop: '1px solid #e2e8f0', marginTop: 15, paddingTop: 15}}>
                <span>
                  <strong>Ma’lumotlar bazasining zaxira nusxasi</strong>
                  <small>Barcha izlanuvchilar, hisoblar va hujjat yozuvlarini JSON fayl sifatida yuklab oling yoki zaxiradan tiklang</small>
                </span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="secondary-button" type="button" onClick={handleBackupDownload}><Database size={15} /> Yuklab olish</button>
                  <input ref={restoreInputRef} className="visually-hidden" type="file" accept=".json,application/json" onChange={handleRestoreFile} />
                  <button className="secondary-button" type="button" onClick={() => restoreInputRef.current?.click()}><Upload size={15} /> Zaxiradan tiklash</button>
                </div>
              </div>

              <div className="settings-row" style={{borderTop: '1px solid #e2e8f0', marginTop: 15, paddingTop: 15}}>
                <span>
                  <strong>Izlanuvchilar parollarini yangilash</strong>
                  <small>Parollar oshkor bo‘lgan bo‘lsa, barcha izlanuvchilar uchun yangi parollar yaratib, Excel faylga yuklab oling</small>
                </span>
                <button className="secondary-button" type="button" onClick={regenerateAllPasswords}>
                  <KeyRound size={15} /> Parollarni yangilash
                </button>
              </div>

              <div className="settings-row" style={{borderTop: '1px solid #e2e8f0', marginTop: 15, paddingTop: 15, alignItems: 'flex-start'}}>
                <span>
                  <strong>Administrator paroli</strong>
                  <small>Admin hisobining kirish parolini o‘zgartirish</small>
                </span>
                <PasswordChangeForm locale={locale} />
              </div>

              <div className="settings-row" style={{borderTop: '1px solid #ffebe9', marginTop: 15, paddingTop: 15}}>
                <span><strong style={{color: '#da1e28'}}>{locale === 'ru' ? 'Удалить все данные' : locale === 'en' ? 'Delete all data' : 'Barcha ma\'lumotlarni o\'chirish'}</strong><small>Tizimdagi barcha izlanuvchilar, hisobotlar, qaydlar va boshqa ma'lumotlar o'chiriladi</small></span>
                <button className="secondary-button danger-button" type="button" onClick={() => {
                  if (window.confirm("Haqiqatan ham barcha ma'lumotlarni o'chirib tashlamoqchimisiz? Bu amalni ortga qaytarib bo'lmaydi!")) {
                    setResearchers([]);
                    setAccounts([]);
                    setActivityLog([]);
                    setNormativeDocuments([]);
                    setExpertiseCases([]);
                    setMonitoringFiles([]);
                    setMonitoringReports([]);
                    setKengashFiles([]);
                    setPostDefenseFiles([]);
                    setPage('overview');
                  }
                }}><Trash2 size={15} />{locale === 'ru' ? 'Удалить все' : locale === 'en' ? 'Delete All' : 'Barchasini o‘chirish'}</button>
              </div>
            </section>

            <section className="module-view panel normative-admin-view">
              <div className="module-toolbar">
                <div>
                  <span className="section-kicker">TADQIQOTCHILAR UCHUN</span>
                  <h2>Ichki normativ hujjatlar</h2>
                  <p>Yuklangan fayllar izlanuvchi kabinetida ko‘rinadi · PDF, DOC, DOCX · 30 MB gacha</p>
                </div>
                <input ref={normativeInputRef} className="visually-hidden" type="file" accept=".pdf,.doc,.docx" multiple onChange={uploadNormativeDocuments} />
                <button className="primary-button" onClick={() => normativeInputRef.current?.click()}><Upload size={15} />Hujjat yuklash</button>
              </div>
              {normativeError && <div className="upload-error"><CircleAlert size={15} />{normativeError}</div>}
              {normativeDocuments.length ? (
                <div className="document-list">
                  {normativeDocuments.map((item) => {
                    const docName = item.name || item.file?.name || 'Normativ_hujjat.pdf'
                    const docSize = ((item.size || item.file?.size || 0) / (1024 * 1024)).toFixed(2)
                    return (
                      <div className="document-row" key={item.id}>
                        <span className="document-icon"><FileText size={17} /></span>
                        <span><strong>{docName}</strong><small>{docSize} MB · barcha izlanuvchilarga ko‘rinadi</small></span>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {item.fileUrl && (
                            <button className="icon-button" title="Yuklab olish / Ko‘rish" onClick={() => openOrDownloadFile(item.fileUrl, docName)}>
                              <ArrowDownToLine size={15} />
                            </button>
                          )}
                          <button className="icon-button" aria-label={`${docName} hujjatini o‘chirish`} onClick={() => setNormativeDocuments((items) => items.filter((document) => document.id !== item.id))}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : <div className="normative-empty">Hali normativ hujjatlar yuklanmagan.</div>}
            </section>
          </div>
        )}

        {page === 'expertise' && <ExpertiseView expertiseCases={expertiseCases} setExpertiseCases={setExpertiseCases} onNavigateNizom={() => navigateTo('nizom')} researchers={researchers} locale={locale} />}
        {page === 'nizom' && <NizomView onNavigateExpertise={() => navigateTo('expertise')} locale={locale} />}

        <footer className="page-footer">
          <span>© 2026 Ilm+ · Jamoat xavfsizligi universiteti Oliy ta’limdan keyingi ta’lim monitoringi</span>
          <span><i className="live-dot" /> Tizim faol · Single Source of Truth sinxron</span>
        </footer>
      </div>
    </main>
    {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false) }}><section className="add-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-top"><div><span className="section-kicker">{locale === 'ru' ? 'НОВЫЙ ПРОФИЛЬ' : locale === 'en' ? 'NEW PROFILE' : 'YANGI PROFIL'}</span><h2 id="modal-title">{locale === 'ru' ? 'Добавить соискателя' : locale === 'en' ? 'Add researcher' : 'Izlanuvchi qo‘shish'}</h2></div><button className="icon-button" aria-label="Yopish" onClick={() => setModalOpen(false)}><X size={19} /></button></div><form onSubmit={createResearcher}><label>{locale === 'ru' ? 'Ф.И.О.' : locale === 'en' ? 'Full Name' : 'F.I.Sh'}<input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={locale === 'ru' ? 'Например, Нодира Каримова' : locale === 'en' ? 'For example, Nodira Karimova' : 'Masalan, Nodira Karimova'} required /></label><label>{locale === 'ru' ? 'Научное направление' : locale === 'en' ? 'Research Area' : 'Ilmiy yo‘nalish'}<input value={newField} onChange={(event) => setNewField(event.target.value)} placeholder={locale === 'ru' ? 'Например, Прикладная математика' : locale === 'en' ? 'For example, Applied mathematics' : 'Masalan, Amaliy matematika'} /></label><label>{locale === 'ru' ? 'Этап' : locale === 'en' ? 'Stage' : 'Bosqich'}<select value={newStage} onChange={(event) => setNewStage(event.target.value)}><option value="1">1-bosqich</option><option value="2">2-bosqich</option><option value="3">3-bosqich</option></select></label><div className="modal-hint"><CircleAlert size={15} /> Ilmiy rahbarni keyinroq biriktirish mumkin.</div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setModalOpen(false)}>{locale === 'ru' ? 'Отмена' : locale === 'en' ? 'Cancel' : 'Bekor qilish'}</button><button className="primary-button" type="submit"><Plus size={16} />{locale === 'ru' ? 'Создать профиль' : locale === 'en' ? 'Create profile' : 'Profil yaratish'}</button></div></form></section></div>}
  </div>
}

function ResearcherEditDialog({ researcher, onClose, onSave, locale }) {
  const sourceData = researcher.excelData || {
    'Familiyasi, ismi va otasining ismi': researcher.name,
    'Mavzulari nomlanishi': researcher.field,
    'Ilmiy rahbari F.I.Sh.': researcher.supervisor,
    'Qabul qilingan sana va buyruq': researcher.admissionOrder || '',
  }

  return <div className="modal-backdrop"><section className="researcher-edit-modal" role="dialog" aria-modal="true" aria-labelledby="researcher-edit-title"><div className="modal-top"><div><span className="section-kicker">{locale === 'ru' ? 'РЕДАКТИРОВАНИЕ ПРОФИЛЯ' : locale === 'en' ? 'EDIT PROFILE' : 'PROFIL TAHRIRI'}</span><h2 id="researcher-edit-title">{researcher.name}</h2></div><button className="icon-button" aria-label="Yopish" onClick={onClose}><X size={19} /></button></div><form onSubmit={onSave}><div className="researcher-edit-grid">{Object.entries(sourceData).map(([label, value]) => <label key={label}>{label}<input name={label} defaultValue={String(value ?? '')} /></label>)}</div><label className="edit-stage-field">Bosqich (qabul yili bo‘yicha avtomatik)<select name="__stage" defaultValue={researcher.stage}><option value="1">1-bosqich</option><option value="2">2-bosqich</option><option value="3">3-bosqich</option></select></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>{locale === 'ru' ? 'Отмена' : locale === 'en' ? 'Cancel' : 'Bekor qilish'}</button><button className="primary-button" type="submit"><Check size={15} />{locale === 'ru' ? 'Сохранить' : locale === 'en' ? 'Save' : 'Saqlash'}</button></div></form></section></div>
}

function ResearcherDetails({ researcher, accounts = [], onClose, onEdit, onDelete, locale, navigateTo }) {
  const sourceData = researcher.excelData || {
    'Familiyasi, ismi va otasining ismi': researcher.name,
    'Mavzulari nomlanishi': researcher.field,
    'Ilmiy rahbari F.I.Sh.': researcher.supervisor,
    Bosqich: `${researcher.stage}-bosqich`,
  }
  const hasStageColumn = Object.keys(sourceData).some((key) => ['bosqich', 'stage', 'kurs'].includes(normalizeHeader(key)))
  const entries = [
    ...Object.entries(sourceData),
    ...(!hasStageColumn ? [['Hisoblangan bosqich', `${researcher.stage}-bosqich`]] : []),
  ].filter(([, value]) => String(value ?? '').trim())

  const status = researcherStatus(researcher)
  const statusLbl = getResearcherStatusText(researcher, locale)
  const userAccount = accounts.find((a) => a.username === researcher.username || a.researcherName === researcher.name)
  const [copiedCreds, setCopiedCreds] = useState(false)

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="researcher-detail-modal" role="dialog" aria-modal="true" aria-labelledby="researcher-detail-title" style={{ width: 'min(90vw, 650px)' }}>
    <div className="modal-top">
      <div>
        <span className="section-kicker">{locale === 'ru' ? 'ДАННЫЕ СОИСКАТЕЛЯ' : locale === 'en' ? 'RESEARCHER DATA' : 'IZLANUVCHI MA’LUMOTLARI'}</span>
        <h2 id="researcher-detail-title">{researcher.name}</h2>
      </div>
      <button className="icon-button" aria-label="Yopish" onClick={onClose}><X size={19} /></button>
    </div>

    <div className="researcher-details-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', margin: '20px 0' }}>
      <div>
        <h3 style={{ fontSize: 13, color: '#21483a', marginBottom: 10 }}>{locale === 'ru' ? 'Основные данные' : locale === 'en' ? 'Basic Info' : 'Asosiy ma\'lumotlar'}</h3>
        <dl className="researcher-detail-list">
          {entries.slice(0, 6).map(([label, value], index) => <div key={`${label}-${index}`}><dt>{label}</dt><dd>{String(value)}</dd></div>)}
        </dl>

        {userAccount && (
          <div style={{ marginTop: 12, padding: '10px 12px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 11, color: '#1e40af', fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Tizimga kirish ma’lumotlari</span>
              <div style={{ fontSize: 12, color: '#1e293b', marginTop: 3 }}>
                Login: <code style={{ color: '#0070f3', fontWeight: 600 }}>{userAccount.username}</code> · Parol: <code style={{ color: '#16a34a', fontWeight: 600 }}>{userAccount.password || '—'}</code>
              </div>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                navigator.clipboard?.writeText(`Login: ${userAccount.username}\nParol: ${userAccount.password || '—'}`)
                setCopiedCreds(true)
                setTimeout(() => setCopiedCreds(false), 2000)
              }}
              title="Login va parolni nusxalash"
            >
              {copiedCreds ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
            </button>
          </div>
        )}
      </div>
      
      <div>
        <h3 style={{ fontSize: 14.5, color: '#21483a', marginBottom: 10 }}>{locale === 'ru' ? 'Отчеты и Мониторинг' : locale === 'en' ? 'Reports and Monitoring' : 'Hisobot va Monitoring'}</h3>
        <div style={{ display: 'grid', gap: 8, padding: 12, background: '#f6f7f5', borderRadius: 6, border: '1px solid #e7ebe7' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e7ebe7', paddingBottom: 5 }}>
            <span style={{ fontSize: 12, color: '#647168' }}>{locale === 'ru' ? 'Общий статус' : locale === 'en' ? 'Overall status' : 'Umumiy holati'}</span>
            <span className={`status-pill status-${status || 'unknown'}`}>{statusLbl}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#647168' }}>Monitoring 2025</span>
            <strong style={{ fontSize: 12, color: '#21483a', textAlign: 'right' }}>{excelValue(researcher, ['monitoring2025']) || 'Kiritilmagan'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#647168' }}>Monitoring 2026</span>
            <strong style={{ fontSize: 12, color: '#21483a', textAlign: 'right' }}>{excelValue(researcher, ['monitoring2026']) || 'Kiritilmagan'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#647168' }}>{locale === 'ru' ? 'Индивидуальный план' : locale === 'en' ? 'Individual plan' : 'Yakka tartibdagi reja'}</span>
            <strong style={{ fontSize: 12, color: '#21483a', textAlign: 'right' }}>{excelValue(researcher, ['yakkatartibdagireja']) || 'Kiritilmagan'}</strong>
          </div>
          
          <button className="text-link" style={{ marginTop: 5, alignSelf: 'flex-start', padding: 0, fontSize: 12 }} onClick={() => { onClose(); if (navigateTo) navigateTo('plans', researcher.stage); }}>{locale === 'ru' ? 'Посмотреть план' : locale === 'en' ? 'View plan' : 'Rejasini ko\'rish'}<ArrowUpRight size={14} />
          </button>
        </div>
      </div>
    </div>

    <div className="modal-actions detail-actions">
      <button className="secondary-button danger-button" onClick={onDelete}><Trash2 size={15} />{locale === 'ru' ? 'Удалить' : locale === 'en' ? 'Delete' : 'O‘chirish'}</button>
      <button className="primary-button" onClick={onEdit}><Pencil size={15} />{locale === 'ru' ? 'Редактировать' : locale === 'en' ? 'Edit' : 'Tahrirlash'}</button>
    </div>
  </section></div>
}

function ResearcherProgress({ researcher }) {
  const progress = researcherProgress(researcher)
  return <div className="table-progress"><span><i className={researcherStatus(researcher) === 'atRisk' ? 'bar-orange' : ''} style={{ width: `${progress ?? 0}%` }} /></span>{progress === null ? '—' : `${progress}%`}</div>
}

function ResearcherStatus({ researcher, locale = 'uz' }) {
  const status = researcherStatus(researcher)
  const label = getResearcherStatusText(researcher, locale)
  return <span className={`status-pill status-${status || 'unknown'}`}><i />{label}</span>
}

function CredentialDialog({ entries = [], onClose, onExport, onLogin, locale }) {
  const [copiedIdx, setCopiedIdx] = useState(null)

  const copyRow = (username, password, idx) => {
    navigator.clipboard?.writeText(`Login: ${username}\nParol: ${password}`)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  return (
    <div className="modal-backdrop credential-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="credential-modal" role="dialog" aria-modal="true" aria-labelledby="credentials-title" style={{ maxWidth: 680, width: '92vw' }}>
        <div className="modal-top">
          <div>
            <span className="section-kicker" style={{ color: '#00c875' }}>
              {locale === 'ru' ? 'ИМПОРТ ЗАВЕРШЕН' : locale === 'en' ? 'IMPORT COMPLETED' : 'IMPORT YAKUNLANDI'}
            </span>
            <h2 id="credentials-title">
              {locale === 'ru' ? 'Сгенерированные логины и пароли' : locale === 'en' ? 'Generated Logins & Passwords' : 'Hosil bo‘lgan login va parollar'} ({entries.length})
            </h2>
          </div>
          <button className="icon-button" aria-label="Yopish" onClick={onClose}><X size={19} /></button>
        </div>

        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 16px', margin: '14px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <KeyRound size={20} color="#16a34a" style={{ flexShrink: 0 }} />
          <p style={{ margin: 0, fontSize: '13px', color: '#166534', lineHeight: 1.4 }}>
            {locale === 'ru'
              ? 'Соискатели успешно добавлены! Вы можете скачать сгенерированные логины и пароли отдельным файлом Excel (.xlsx) для передачи соискателям.'
              : locale === 'en'
              ? 'Researchers added successfully! You can download generated credentials as an Excel (.xlsx) file to distribute to researchers.'
              : 'Izlanuvchilar muvaffaqiyatli qo‘shildi! Hosil bo‘lgan login va parollarni izlanuvchilarga tarqatish uchun Excel (.xlsx) fayl shaklida yuklab oling.'}
          </p>
        </div>

        <div className="credentials-list" style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#fff' }}>
          {entries.map((item, idx) => (
            <div className="credential-row" key={item.username || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: idx < entries.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
              <div>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>{item.researcherName || item.name}</strong>
                <div style={{ display: 'flex', gap: '12px', marginTop: '3px', fontSize: '12px', color: '#475569' }}>
                  <span>{item.stage || 1}-bosqich</span>
                  <span>Login: <code style={{ background: '#eff6ff', padding: '1px 5px', borderRadius: '3px', color: '#0070f3' }}>{item.username}</code></span>
                  <span>Parol: <code style={{ background: '#f0fdf4', padding: '1px 5px', borderRadius: '3px', color: '#16a34a', fontWeight: 'bold' }}>{item.password}</code></span>
                </div>
              </div>
              <button
                className="icon-button"
                aria-label="Nusxalash"
                onClick={() => copyRow(item.username, item.password, idx)}
                title="Login va parolni nusxalash"
              >
                {copiedIdx === idx ? <Check size={16} color="#16a34a" /> : <Copy size={15} />}
              </button>
            </div>
          ))}
        </div>

        <div className="modal-actions" style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <button className="primary-button" onClick={() => onExport(entries)} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#0070f3' }}>
            <ArrowDownToLine size={16} />
            {locale === 'ru' ? 'Скачать Excel (.xlsx)' : locale === 'en' ? 'Download Excel (.xlsx)' : 'Excel (.xlsx) yuklab olish'}
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="secondary-button" onClick={onClose}>
              {locale === 'ru' ? 'Закрыть' : locale === 'en' ? 'Close' : 'Yopish'}
            </button>
            <button className="secondary-button" onClick={onLogin}>
              {locale === 'ru' ? 'Вход в систему' : locale === 'en' ? 'Go to Login' : 'Login sahifasi'}
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

function UnifiedLogin({ onLogin, error, locale }) {
  const [role, setRole] = useState('researcher')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await onLogin(role, username, password)
    } finally {
      setBusy(false)
    }
  }

  return <main className="login-screen">
    <video autoPlay loop muted playsInline preload="metadata" poster="./logo.jpg" className="login-bg-video"><source src="./video.mp4" type="video/mp4" /></video>
    <div className="login-overlay"></div>
    <section className="login-panel">
      <BrandMark locale={locale} variant="login" onClick={(e) => e.preventDefault()} />
      <span className="section-kicker">{locale === 'ru' ? 'ВХОД В СИСТЕМУ' : locale === 'en' ? 'SYSTEM LOGIN' : 'TIZIMGA KIRISH'}</span>
      <h1>{locale === 'ru' ? 'Добро пожаловать' : locale === 'en' ? 'Welcome' : 'Xush kelibsiz'}</h1>
      
      <div className="login-role-tabs">
        <button type="button" className={`role-tab ${role === 'researcher' ? 'active' : ''}`} onClick={() => { setRole('researcher'); setUsername(''); setPassword(''); }}>{locale === 'ru' ? 'Соискатель' : locale === 'en' ? 'Researcher' : 'Tadqiqotchi'}</button>
        <button type="button" className={`role-tab ${role === 'admin' ? 'active' : ''}`} onClick={() => { setRole('admin'); setUsername(''); setPassword(''); }}>{locale === 'ru' ? 'Администратор' : locale === 'en' ? 'Administrator' : 'Administrator'}</button>
      </div>
      
      <p>{role === 'admin' ? "Boshqaruv paneliga kirish uchun admin login va parolini kiriting." : "Tizimga kirish uchun administrator taqdim etgan login va parolni kiriting."}</p>
      
      <form onSubmit={submit}>
        <label>{locale === 'ru' ? 'Логин' : locale === 'en' ? 'Login' : 'Login'}<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required placeholder={role === 'admin' ? "Admin logini" : "Tadqiqotchi logini"} /></label>
        <label>{locale === 'ru' ? 'Пароль' : locale === 'en' ? 'Password' : 'Parol'}<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required placeholder={role === 'admin' ? "Admin paroli" : "Parol"} /></label>
        {error && <div className="login-error"><CircleAlert size={15} />{error}</div>}
        <button className="primary-button" type="submit" disabled={busy}><LockKeyhole size={16} />{busy ? '...' : locale === 'ru' ? 'Войти' : locale === 'en' ? 'Login' : 'Tizimga kirish'}</button>
      </form>
    </section>
  </main>
}

const BRAND_TEXT = {
  uz: { country: 'O‘zbekiston Respublikasi', university: 'Jamoat xavfsizligi universiteti', faculty: 'Oliy ta’limdan keyingi ta’lim fakulteti' },
  ru: { country: 'Республика Узбекистан', university: 'Университет общественной безопасности', faculty: 'Факультет послевузовского образования' },
  en: { country: 'Republic of Uzbekistan', university: 'University of Public Safety', faculty: 'Faculty of Postgraduate Education' }
}

function BrandMark({ locale = 'uz', variant = 'sidebar', onClick, href = '#overview' }) {
  const t = BRAND_TEXT[locale] || BRAND_TEXT.uz
  return (
    <a className={`brandmark brandmark-${variant}`} href={href} onClick={onClick} aria-label={`Ilm+ — ${t.university}`}>
      <img src="./logo.jpg" alt="" className="brandmark-logo" />
      <span className="brandmark-divider" aria-hidden="true" />
      <span className="brandmark-text">
        <strong>Ilm<em>+</em></strong>
        <span className="brandmark-org">{t.university}</span>
        <span className="brandmark-faculty">{t.faculty}</span>
        <i className="brandmark-bar" aria-hidden="true" />
      </span>
    </a>
  )
}

function ResearcherWorkspace({ user, normativeDocuments, expertiseCases, setExpertiseCases, onLogout, monitoringFiles, setMonitoringFiles, monitoringReports, setMonitoringReports, kengashFiles, setKengashFiles, postDefenseFiles, setPostDefenseFiles, theme, setTheme, locale, setLocale, isOnline, lastSyncTime, isSyncing, syncError, doFetchSync }) {
  const [tab, setTab] = useState('dashboard')
  const [seminarMenuOpen, setSeminarMenuOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const seminarRef = useRef(null)

  const rejectedCount = (postDefenseFiles || []).filter(f => f.username === user.username && f.status === 'Rad etildi').length
  const tr = (uz, ru, en) => (locale === 'ru' ? ru : locale === 'en' ? en : uz)

  // Ochiq menyuni tashqariga bosilganda yoki Esc tugmasida yopish
  useEffect(() => {
    if (!seminarMenuOpen && !mobileMenuOpen) return
    const onPointer = (event) => {
      if (seminarRef.current && !seminarRef.current.contains(event.target)) setSeminarMenuOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setSeminarMenuOpen(false)
        setMobileMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [seminarMenuOpen, mobileMenuOpen])

  function go(nextTab) {
    setTab(nextTab)
    setSeminarMenuOpen(false)
    setMobileMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const navItems = [
    { key: 'dashboard', icon: LayoutDashboard, label: tr('Mening kabinetim', 'Мой кабинет', 'My cabinet') },
    { key: 'documents', icon: FileText, label: tr('Shaxsiy hujjatlar', 'Личные документы', 'Documents') },
    { key: 'expertise', icon: ShieldCheck, label: tr('Ekspertiza arizasi', 'Экспертиза', 'Expertise') },
    { key: 'seminar_group', icon: UsersRound, label: tr('Seminar / Kengash', 'Семинар / Совет', 'Seminar / Council') },
    { key: 'post_defense', icon: FileCheck, label: tr('Himoyadan keyingi hujjatlar', 'После защиты', 'Post-defense'), alert: rejectedCount > 0 },
    { key: 'nizom', icon: BookOpen, label: tr('Nizom va me’yorlar', 'Нормы', 'Regulations') },
    { key: 'settings', icon: Settings2, label: tr('Sozlamalar', 'Настройки', 'Settings') }
  ]
  const seminarItems = [
    { key: 'seminar', title: tr('Ilmiy seminarga', 'Научный семинар', 'Scientific seminar'), note: tr('Ilmiy seminar uchun ariza va hujjatlar', 'Заявка и документы на научный семинар', 'Application and documents for the seminar') },
    { key: 'kengash', title: tr('Bir martalik kengashga', 'Разовый совет', 'One-time council'), note: tr('Bir martalik ilmiy kengash uchun hujjatlar', 'Документы для разового совета', 'Documents for the one-time council') }
  ]
  const seminarActive = tab === 'seminar' || tab === 'kengash'
  const initials = String(user.researcherName || user.username || '?').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

  return <main className="portal-shell">
    <header className="rp-header">
      <div className="rp-header-inner">
        <div className="rp-topline">
          <BrandMark locale={locale} variant="portal" onClick={(e) => { e.preventDefault(); go('dashboard') }} />
          <div className="rp-tools">
            <SyncIndicator isOnline={isOnline} isSyncing={isSyncing} syncError={syncError} lastSyncTime={lastSyncTime} onSync={doFetchSync} compact />
            <div className="locale-picker rp-locale" aria-label="Interfeys tili">{['uz', 'ru', 'en'].map((language) => <button key={language} className={locale === language ? 'locale-active' : ''} onClick={() => setLocale(language)}>{language.toUpperCase()}</button>)}</div>
            <div className="rp-user" title={user.researcherName}>
              <span className="rp-avatar">{initials}</span>
              <span className="rp-user-text"><strong>{user.researcherName}</strong><small>{user.stage}-{tr('bosqich', 'этап', 'stage')} · {user.username}</small></span>
            </div>
            <button className="rp-logout" onClick={onLogout} title={tr('Chiqish', 'Выйти', 'Logout')} aria-label={tr('Chiqish', 'Выйти', 'Logout')}><LogOut size={17} /><span>{tr('Chiqish', 'Выйти', 'Logout')}</span></button>
          </div>
        </div>

        <nav className={`rp-navbar ${mobileMenuOpen ? 'rp-navbar-open' : ''}`} aria-label={tr('Asosiy menyu', 'Главное меню', 'Main menu')}>
          <button className="rp-burger" aria-label={tr('Menyuni ochish', 'Открыть меню', 'Open menu')} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            <span>{navItems.find((item) => item.key === tab)?.label || seminarItems.find((item) => item.key === tab)?.title}</span>
          </button>
          <div className="rp-nav-items">
            {navItems.map(({ key, icon: Icon, label, alert: hasAlert }) => key === 'seminar_group' ? (
              <div key={key} className="rp-dropdown" ref={seminarRef}>
                <button className={`rp-nav-item ${seminarActive ? 'active' : ''}`} aria-haspopup="true" aria-expanded={seminarMenuOpen} onClick={() => setSeminarMenuOpen((open) => !open)}>
                  <Icon size={16} /><span>{label}</span><ChevronDown size={15} className={`rp-chevron ${seminarMenuOpen ? 'open' : ''}`} />
                </button>
                {seminarMenuOpen && (
                  <div className="rp-dropdown-panel" role="menu">
                    {seminarItems.map((item) => (
                      <button key={item.key} role="menuitem" className={`rp-dropdown-item ${tab === item.key ? 'active' : ''}`} onClick={() => go(item.key)}>
                        <span className="rp-dropdown-icon"><UsersRound size={17} /></span>
                        <span><strong>{item.title}</strong><small>{item.note}</small></span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button key={key} className={`rp-nav-item ${tab === key ? 'active' : ''}`} onClick={() => go(key)}>
                <Icon size={16} /><span>{label}</span>{hasAlert && <i className="rp-nav-alert" title={tr('Qaytarilgan hujjat bor', 'Есть возвращённые документы', 'Returned documents')}>!</i>}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </header>
    {mobileMenuOpen && <button className="rp-scrim" aria-label={tr('Menyuni yopish', 'Закрыть меню', 'Close menu')} onClick={() => setMobileMenuOpen(false)} />}

    {tab === 'dashboard' && <ResearcherDashboard user={user} normativeDocuments={normativeDocuments} locale={locale} />}
    {tab === 'documents' && <ResearcherDocumentsApp user={user} files={monitoringFiles} setFiles={setMonitoringFiles} reports={monitoringReports} setReports={setMonitoringReports} locale={locale} />}
    {tab === 'expertise' && <ResearcherExpertiseApp user={user} expertiseCases={expertiseCases} setExpertiseCases={setExpertiseCases} locale={locale} />}
    {tab === 'seminar' && <div className="portal-content"><KengashStudentView user={user} kengashFiles={kengashFiles} setKengashFiles={setKengashFiles} isSeminar={true} locale={locale} /></div>}
    {tab === 'kengash' && <div className="portal-content"><KengashStudentView user={user} kengashFiles={kengashFiles} setKengashFiles={setKengashFiles} locale={locale} /></div>}
    {tab === 'post_defense' && <div className="portal-content"><PostDefenseStudentView user={user} postDefenseFiles={postDefenseFiles} setPostDefenseFiles={setPostDefenseFiles} locale={locale} /></div>}
    {tab === 'nizom' && <div className="portal-content"><NizomView onNavigateExpertise={() => setTab('expertise')} locale={locale} /></div>}
    {tab === 'settings' && <ResearcherSettings theme={theme} setTheme={setTheme} locale={locale} />}
  </main>
}

function ResearcherSettings({ theme, setTheme, locale }) {
  return (
    <div className="portal-content">
      <section className="portal-documents panel">
        <div className="module-toolbar">
          <div>
            <span className="section-kicker">{locale === 'ru' ? 'НАСТРОЙКИ' : locale === 'en' ? 'SETTINGS' : 'SOZLAMALAR'}</span>
            <h2>{locale === 'ru' ? 'Настройки соискателя' : locale === 'en' ? 'Researcher settings' : 'Tadqiqotchi sozlamalari'}</h2>
          </div>
        </div>

        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="setting-group" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #dce5e0', paddingBottom: 15, gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong style={{ display: 'block', marginBottom: 5 }}>{locale === 'ru' ? 'Тема системы' : locale === 'en' ? 'System Theme' : 'Tizim ko\'rinishi'}</strong>
              <small style={{ color: '#8b978e' }}>{locale === 'ru' ? 'Выберите светлый или темный режим' : locale === 'en' ? 'Select light or dark mode' : 'Kunduzgi yoki kechki rejimni tanlang'}</small>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className={`secondary-button ${theme === 'light' ? 'primary-button' : ''}`} style={theme === 'light' ? {} : {background: 'transparent', borderColor: '#dce5e0'}} onClick={() => setTheme('light')}>{locale === 'ru' ? 'Светлый' : locale === 'en' ? 'Light' : 'Kunduzgi'}</button>
              <button className={`secondary-button ${theme === 'dark' ? 'primary-button' : ''}`} style={theme === 'dark' ? {} : {background: 'transparent', borderColor: '#dce5e0'}} onClick={() => setTheme('dark')}>{locale === 'ru' ? 'Темный' : locale === 'en' ? 'Dark' : 'Kechki'}</button>
            </div>
          </div>

          <div className="setting-group">
            <div>
              <strong style={{ display: 'block', marginBottom: 5 }}>{locale === 'ru' ? 'Пароль для входа' : locale === 'en' ? 'Login Password' : 'Kirish paroli'}</strong>
              <small style={{ color: '#8b978e' }}>{locale === 'ru' ? 'Обновите пароль для входа в систему' : locale === 'en' ? 'Update your password to log in' : 'Tizimga kirish uchun parolingizni yangilang'}</small>
            </div>
            <PasswordChangeForm locale={locale} />
          </div>
        </div>
      </section>
    </div>
  )
}

function PasswordChangeForm({ locale }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (newPassword.length < 6) {
      setMessage({ ok: false, text: 'Yangi parol kamida 6 ta belgidan iborat bo‘lishi kerak.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setMessage({ ok: false, text: 'Yangi parol va uning takrori mos kelmadi.' })
      return
    }
    setBusy(true)
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage({ ok: true, text: 'Parol muvaffaqiyatli saqlandi!' })
    } catch (error) {
      setMessage({ ok: false, text: error.message })
    } finally {
      setBusy(false)
    }
  }

  const inputStyle = { height: 36, padding: '0 10px', borderRadius: 4, border: '1px solid #dce5e0', width: '100%', maxWidth: 300 }
  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 8, marginTop: 10, maxWidth: 320 }}>
      <input type="password" autoComplete="current-password" placeholder={locale === 'ru' ? 'Текущий пароль' : locale === 'en' ? 'Current password' : 'Joriy parol'} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={inputStyle} required />
      <input type="password" autoComplete="new-password" placeholder={locale === 'ru' ? 'Новый пароль' : locale === 'en' ? 'New password' : 'Yangi parol'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={inputStyle} required minLength={6} />
      <input type="password" autoComplete="new-password" placeholder={locale === 'ru' ? 'Повторите новый пароль' : locale === 'en' ? 'Repeat new password' : 'Yangi parolni takrorlang'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={inputStyle} required minLength={6} />
      <button type="submit" className="primary-button" disabled={busy} style={{ justifySelf: 'start' }}>{busy ? '...' : locale === 'ru' ? 'Сохранить' : locale === 'en' ? 'Save' : 'Saqlash'}</button>
      {message && <p style={{ color: message.ok ? '#58a071' : '#da1e28', fontSize: 12, margin: 0 }}>{message.ok ? <Check size={14} style={{ verticalAlign: 'middle' }} /> : <CircleAlert size={14} style={{ verticalAlign: 'middle' }} />} {message.text}</p>}
    </form>
  )
}

function SyncIndicator({ isOnline, isSyncing, syncError, lastSyncTime, onSync, compact = false }) {
  const healthy = isOnline && !syncError
  const color = healthy ? '#16a34a' : isOnline ? '#d97706' : '#dc2626'
  const label = !isOnline ? 'Oflayn' : isSyncing ? 'Sinxronlanmoqda...' : syncError ? 'Saqlanmadi' : 'Real-vaqt faol'
  const title = !isOnline
    ? 'Serverga ulanmagan. O‘zgarishlar ulanish tiklangach yuboriladi.'
    : syncError || `Serverga ulangan. So‘nggi sinxron: ${lastSyncTime || 'biroz oldin'}`
  return (
    <div className="live-sync-indicator" title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: compact ? '3px 8px' : '4px 10px', borderRadius: 20, background: `${color}1f`, border: `1px solid ${color}4d`, fontSize: compact ? 11 : 12, color }}>
      <span style={{ width: compact ? 7 : 8, height: compact ? 7 : 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span style={{ fontWeight: 600 }}>{label}</span>
      <button className={`icon-button ${isSyncing ? 'spin' : ''}`} style={{ padding: compact ? 0 : 2, height: 'auto', width: 'auto', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }} onClick={onSync} title="Hozir sinxronlash" aria-label="Hozir sinxronlash">
        <RefreshCw size={compact ? 11 : 12} />
      </button>
    </div>
  )
}

function LoadingScreen({ text, onRetry, onLogout }) {
  return (
    <main className="login-screen">
      <section className="login-panel" style={{ textAlign: 'center', gap: 16 }}>
        <img src="./logo.jpg" alt="Logo" className="brand-logo" style={{ margin: '0 auto' }} />
        <p>{text}</p>
        {(onRetry || onLogout) && (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            {onRetry && <button className="primary-button" onClick={onRetry}><RefreshCw size={15} /> Qayta urinish</button>}
            {onLogout && <button className="secondary-button" onClick={onLogout}><LogOut size={15} /> Chiqish</button>}
          </div>
        )}
      </section>
    </main>
  )
}

function ResearcherDocumentsApp({ user, files, setFiles, reports, setReports, locale }) {
  const [subTab, setSubTab] = useState('ish_reja')
  const [modalOpen, setModalOpen] = useState(false)
  
  const [docName, setDocName] = useState('')
  const [docType, setDocType] = useState('Maqola')
  const yearOptions = [0, 1, 2, 3].map((offset) => String(new Date().getFullYear() - 2 + offset))
  const [docYear, setDocYear] = useState(() => String(new Date().getFullYear()))
  const [docQuarter, setDocQuarter] = useState('1')
  const [selectedFiles, setSelectedFiles] = useState([])
  
  const [reportStage, setReportStage] = useState(String(user.stage || 1))
  const [reportYear, setReportYear] = useState(() => String(new Date().getFullYear()))

  const userFiles = files.filter(f => f.username === user.username)
  const userReports = reports.filter(r => r.username === user.username)
  
  const [isSubmittingDoc, setIsSubmittingDoc] = useState(false)

  function handleFileSelect(e) {
    if (!e.target.files.length) return
    const uploaded = Array.from(e.target.files)
    if (uploaded.length > 40) return alert("Bitta punktga ko'pi bilan 40 ta fayl yuklash mumkin.")
    
    const validFiles = []
    for (const file of uploaded) {
      if (file.size > 30 * 1024 * 1024) {
        return alert(`${file.name} hajmi 30 MB dan oshmasligi kerak.`)
      }
      validFiles.push({
        rawFile: file,
        name: file.name,
        size: (file.size / 1024 / 1024).toFixed(2) + ' MB'
      })
    }
    setSelectedFiles(validFiles)
  }
  
  async function createDoc(e) {
    e.preventDefault()
    if (!selectedFiles.length && !docName) return alert('Iltimos, fayl yuklang yoki nom kiriting.')
    setIsSubmittingDoc(true)
    try {
      const uploadedFilesMeta = []
      for (const item of selectedFiles) {
        if (item.rawFile) {
          const up = await uploadRealFile(item.rawFile, 'Ish reja hujjati', { username: user.username })
          uploadedFilesMeta.push({
            name: item.name,
            size: item.size,
            fileUrl: up.fileUrl,
            url: up.fileUrl
          })
        } else {
          uploadedFilesMeta.push(item)
        }
      }
      const fileName = uploadedFilesMeta.length === 1 ? uploadedFilesMeta[0].name : (uploadedFilesMeta.length > 1 ? `${uploadedFilesMeta.length} ta fayl` : 'Hujjat_fayli')
      const totalSize = uploadedFilesMeta.length > 0 ? uploadedFilesMeta.reduce((acc, f) => acc + parseFloat(f.size || 0), 0).toFixed(2) + ' MB' : '0 MB'
      const newFile = {
        id: uid('doc'),
        username: user.username,
        name: docName || fileName,
        fileName: fileName,
        type: docType,
        period: `${docYear}/${docQuarter}`,
        size: totalSize,
        files: uploadedFilesMeta
      }
      setFiles((items) => [newFile, ...items])
      setModalOpen(false)
      setDocName('')
      setSelectedFiles([])
    } catch (err) {
      alert('Yuklashda xatolik yuz berdi: ' + err.message)
    } finally {
      setIsSubmittingDoc(false)
    }
  }
  
  function createReport(e) {
    e.preventDefault()
    const newReport = {
      id: uid('rep'),
      username: user.username,
      fio: user.researcherName || user.name,
      org: 'Jamoat xavfsizligi universiteti',
      stage: reportStage,
      quarter: `${reportYear}/1`,
      status: 'Kutilmoqda'
    }
    setReports((items) => [newReport, ...items])
    setModalOpen(false)
  }

  function deleteFile(id) {
    if (!window.confirm('Ushbu hujjatni o‘chirishni tasdiqlaysizmi?')) return
    setFiles((items) => items.filter(f => f.id !== id))
  }
  function deleteReport(id) {
    if (!window.confirm('Ushbu hisobotni o‘chirishni tasdiqlaysizmi?')) return
    setReports((items) => items.filter(r => r.id !== id))
  }

  return (
    <div className="portal-content" style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      <div className="panel" style={{ width: '250px', padding: '15px 0' }}>
        <h3 style={{ fontSize: 11, color: '#8b978e', padding: '0 15px', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{locale === 'ru' ? 'Личные документы' : locale === 'en' ? 'Personal Documents' : 'Shaxsiy hujjatlar'}</h3>
        <button className={`nav-item ${subTab === 'ish_reja' ? 'nav-active' : ''}`} onClick={() => setSubTab('ish_reja')} style={{ margin: '0 10px', width: 'calc(100% - 20px)' }}><FileText size={16} />{locale === 'ru' ? 'План работы' : locale === 'en' ? 'Work plan' : 'Ish reja'}</button>
        <button className={`nav-item ${subTab === 'monitoring' ? 'nav-active' : ''}`} onClick={() => setSubTab('monitoring')} style={{ margin: '0 10px', width: 'calc(100% - 20px)' }}><ClipboardCheck size={16} />{locale === 'ru' ? 'Отчет мониторинга' : locale === 'en' ? 'Monitoring report' : 'Monitoring hisoboti'}</button>
      </div>
      
      <div className="panel" style={{ flex: 1, minHeight: '400px' }}>
        <div className="module-toolbar">
          <div>
            <span className="section-kicker">{subTab === 'ish_reja' ? 'ISH REJA' : 'MONITORING HISOBOTI'}</span>
            <h2>{subTab === 'ish_reja' ? 'Monitoring' : 'Monitoring holati'}</h2>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="primary-button" onClick={() => { setModalOpen(true); setSelectedFiles([]); }}>{locale === 'ru' ? 'Создать' : locale === 'en' ? 'Create' : 'Yaratish'}</button>
            {subTab === 'ish_reja' && <button className="secondary-button" style={{ background: '#5e4ec8', color: '#fff', borderColor: '#5e4ec8' }} onClick={() => setSubTab('monitoring')}>{locale === 'ru' ? 'Отчет мониторинга' : locale === 'en' ? 'Monitoring report' : 'Monitoring hisoboti'}</button>}
          </div>
        </div>
        
        <div className="table-scroll">
          {subTab === 'ish_reja' ? (
            <table>
              <thead>
                <tr>
                  <th>#</th><th>{locale === 'ru' ? 'НАЗВАНИЕ' : locale === 'en' ? 'NAME' : 'NOMI'}</th><th>{locale === 'ru' ? 'ПЕРИОД' : locale === 'en' ? 'PERIOD' : 'DAVR'}</th><th>{locale === 'ru' ? 'ТИП РАБОТЫ' : locale === 'en' ? 'WORK TYPE' : 'ISH TURI'}</th><th>{locale === 'ru' ? 'ФАЙЛ' : locale === 'en' ? 'FILE' : 'FAYL'}</th><th>{locale === 'ru' ? 'ДЕЙСТВИЯ' : locale === 'en' ? 'ACTIONS' : 'HARAKATLAR'}</th>
                </tr>
              </thead>
              <tbody>
                {userFiles.map((f, i) => (
                  <tr key={f.id}>
                    <td>{i + 1}</td>
                    <td>{f.name}</td>
                    <td>{f.period}</td>
                    <td>{f.type}</td>
                    <td>
                      {f.files && f.files.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {f.files.map((file, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => openOrDownloadFile(file.fileUrl || file.url, file.name)}
                              className="text-link"
                              style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontSize: 12 }}
                              title="Yuklab olish / ochish"
                            >
                              {file.name}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => f.fileUrl && openOrDownloadFile(f.fileUrl, f.fileName || f.name)}
                          className="text-link"
                          style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: f.fileUrl ? 'pointer' : 'default', fontSize: 12 }}
                          title={f.fileUrl ? "Yuklab olish / ochish" : undefined}
                        >
                          {f.fileName || (locale === 'ru' ? 'Файл' : locale === 'en' ? 'File' : 'Fayl')}
                        </button>
                      )}
                    </td>
                    <td><button className="icon-button" onClick={() => deleteFile(f.id)}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
                {userFiles.length === 0 && <tr><td colSpan="6" style={{ textAlign: 'center', padding: 20, color: '#8b978e' }}>Hech qanday mos yozuv topilmadi</td></tr>}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th><th>F.I.O.</th><th>{locale === 'ru' ? 'ОРГАНИЗАЦИЯ' : locale === 'en' ? 'ORGANIZATION' : 'TASHKILOT'}</th><th>{locale === 'ru' ? 'ЭТАП ОБУЧЕНИЯ' : locale === 'en' ? 'EDUCATION STAGE' : 'TA\'LIM BOSQICHI'}</th><th>{locale === 'ru' ? 'КВАРТАЛ' : locale === 'en' ? 'QUARTER' : 'CHORAK'}</th><th>HOLAT</th><th>{locale === 'ru' ? 'ДЕЙСТВИЯ' : locale === 'en' ? 'ACTIONS' : 'HARAKATLAR'}</th>
                </tr>
              </thead>
              <tbody>
                {userReports.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td>{r.fio}</td>
                    <td>{r.org}</td>
                    <td>{r.stage}</td>
                    <td>{r.quarter}</td>
                    <td><span className={`status-pill ${r.status === 'Qabul qilindi' ? 'status-inProgress' : r.status === 'Rad etildi' ? 'status-atRisk' : 'status-needsReview'}`} style={r.status === 'Kutilmoqda' ? { backgroundColor: '#ff9800', color: '#fff' } : r.status === 'Rad etildi' ? { backgroundColor: '#da1e28', color: '#fff' } : {}}>{r.status}</span></td>
                    <td>{r.status === 'Kutilmoqda' ? <button className="icon-button" aria-label="Hisobotni o‘chirish" onClick={() => deleteReport(r.id)}><Trash2 size={14} /></button> : <span style={{ fontSize: 11, color: '#8b978e' }}>—</span>}</td>
                  </tr>
                ))}
                {userReports.length === 0 && <tr><td colSpan="7" style={{ textAlign: 'center', padding: 20, color: '#8b978e' }}>Hech qanday mos yozuv topilmadi</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
      
      {modalOpen && (
        <div className="modal-backdrop">
          <section className="researcher-detail-modal" style={{ width: 450 }}>
            <div className="modal-top">
              <div><span className="section-kicker">YARATISH</span><h2>{subTab === 'ish_reja' ? 'Yangi hujjat' : 'Monitoring hisoboti'}</h2></div>
              <button className="icon-button" onClick={() => setModalOpen(false)}><X size={19}/></button>
            </div>
            {subTab === 'ish_reja' ? (
              <form onSubmit={createDoc} style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 15 }}>
                <div style={{ padding: 10, background: '#f5f8ff', color: '#0043ce', fontSize: 11, borderRadius: 4, lineHeight: 1.4 }}>
                  <strong>Eslatma:</strong> Stajor-tadqiqotchi va doktorantlar qabuli har yili 1-chorakda amalga oshirilgani bois, monitoring hujjatlarini faqat 4-chorakni belgilab kiritishi lozim.
                </div>
                <label className="input-group">
                  <span>Hujjat nomi</span>
                  <input value={docName} onChange={e => setDocName(e.target.value)} required />
                </label>
                <label className="input-group">
                  <span>Ish turi</span>
                  <select value={docType} onChange={e => setDocType(e.target.value)}>
                    <option>Maqola</option><option>Tezis</option><option>Monografiya</option><option>{locale === 'ru' ? 'Другое' : locale === 'en' ? 'Other' : 'Boshqa'}</option>
                  </select>
                </label>
                <div style={{ display: 'flex', gap: 15 }}>
                  <label className="input-group" style={{ flex: 1 }}>
                    <span>Hisobot davri</span>
                    <select value={docYear} onChange={e => setDocYear(e.target.value)}>
                      {yearOptions.map((year) => <option key={year}>{year}</option>)}
                    </select>
                  </label>
                  <label className="input-group" style={{ flex: 1 }}>
                    <span>Chorak</span>
                    <select value={docQuarter} onChange={e => setDocQuarter(e.target.value)}>
                      <option>1</option><option>2</option><option>3</option><option>4</option>
                    </select>
                  </label>
                </div>
                <label className="input-group">
                  <span>{locale === 'ru' ? 'Файл' : locale === 'en' ? 'File' : 'Fayl'}</span>
                  <div className="file-drop-area" style={{ height: 60, minHeight: 60, marginTop: 5 }}>
                    <input type="file" multiple onChange={handleFileSelect} accept=".pdf,.doc,.docx,.jpg,.jpeg" className="visually-hidden" id="ish-reja-upload" />
                    <label htmlFor="ish-reja-upload" style={{ cursor: 'pointer', fontSize: 12, color: '#58a071', textDecoration: 'underline' }}>
                      {selectedFiles.length > 0 ? `${selectedFiles.length} ta fayl tanlandi` : 'Fayllarni tanlang yoki bu yerga tashlang...'}
                    </label>
                  </div>
                </label>
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button type="submit" className="primary-button" disabled={isSubmittingDoc}>{isSubmittingDoc ? 'Yuklanmoqda...' : locale === 'ru' ? 'Создать' : locale === 'en' ? 'Create' : 'Yaratish'}</button>
                  <button type="button" className="secondary-button" disabled={isSubmittingDoc} onClick={() => setModalOpen(false)}>{locale === 'ru' ? 'Отмена' : locale === 'en' ? 'Cancel' : 'Bekor qilish'}</button>
                </div>
              </form>
            ) : (
              <form onSubmit={createReport} style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 15 }}>
                <div style={{ padding: 10, background: '#fff5f5', color: '#c41c1c', fontSize: 11, borderRadius: 4, lineHeight: 1.4 }}>
                  <strong>Eslatma:</strong> Izlanuvchi monitoring topshirish yili va ta'lim bosqichini tanlaganda ish rejada ushbu yil uchun Nizom talablarida ko'rsatilgan hujjatlar to'liq va xatosiz kiritilgan bo'lishi lozim.
                </div>
                <label className="input-group">
                  <span>Ta'lim bosqichi</span>
                  <select value={reportStage} onChange={e => setReportStage(e.target.value)}>
                    <option value="1">1-bosqich</option><option value="2">2-bosqich</option><option value="3">3-bosqich</option>
                  </select>
                </label>
                <label className="input-group">
                  <span>Yil</span>
                  <select value={reportYear} onChange={e => setReportYear(e.target.value)}>
                    {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
                  </select>
                </label>
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button type="submit" className="primary-button">{locale === 'ru' ? 'Создать' : locale === 'en' ? 'Create' : 'Yaratish'}</button>
                  <button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>{locale === 'ru' ? 'Отмена' : locale === 'en' ? 'Cancel' : 'Bekor qilish'}</button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function ResearcherDashboard({ user, normativeDocuments }) {
  const currentPlan = STUDY_PLANS[user.stage] || []

  return <div className="portal-content">
    <div className="portal-heading">
      <div>
        <span className="section-kicker">{user.stage}-BOSQICH · IZLANUVCHI KABINETI</span>
        <h1>Xush kelibsiz, {user.researcherName || user.name}</h1>
        <p>Hisobotlaringiz va ilmiy hujjatlaringiz</p>
      </div>
      <span className="stage-badge">{user.username}</span>
    </div>
    <section className="portal-summary">
      <div><span>Ta’lim bosqichi</span><strong>{user.stage}-bosqich</strong></div>
      <div><span>Hisobot davri</span><strong>{currentAcademicYear()} · 1-chorak</strong></div>
      <div><span>Hisob holati</span><strong className="account-active"><i />Faol</strong></div>
    </section>
    
    <section className="portal-documents panel">
      <div className="module-toolbar">
        <div><span className="section-kicker">REJA BIZNES-JARAYONI</span><h2>Yakka tartibdagi reja ({user.stage}-yil)</h2><p>Mazkur bosqich uchun bajarilishi lozim bo‘lgan vazifalar ro‘yxati</p></div>
      </div>
      <div className="study-plan-list">
        {currentPlan.map((task, idx) => (
          <div className="study-plan-item" key={task.id}>
            <span className="plan-number">{idx + 1}</span>
            <div className="plan-detail">
              <strong>{task.title}</strong>
              <small>Muddat: {task.deadline}</small>
            </div>
          </div>
        ))}
      </div>
    </section>

    <section className="portal-documents panel">
      <div className="module-toolbar">
        <div><span className="section-kicker">UNIVERSITET HUJJATLARI</span><h2>Ichki normativ hujjatlar</h2><p>Ilmiy faoliyat va oliy ta’limdan keyingi ta’lim bo‘yicha hujjatlar</p></div>
      </div>
      {normativeDocuments.length ? (
        <div className="document-list">
          {normativeDocuments.map((item) => {
            const fileName = item.name || item.file?.name || 'Hujjat.pdf'
            const fileSize = item.size ? item.size : item.file?.size ? (item.file.size / (1024 * 1024)).toFixed(2) + ' MB' : ''
            const fileTarget = item.fileUrl || item.url
            return (
              <div className="document-row" key={item.id}>
                <span className="document-icon"><FileText size={17} /></span>
                <span><strong>{fileName}</strong><small>{fileSize ? `${fileSize} · ` : ''}universitet hujjati</small></span>
                <button
                  className="icon-button"
                  aria-label={`${fileName} hujjatini yuklab olish`}
                  onClick={() => openOrDownloadFile(fileTarget, fileName)}
                  title="Yuklab olish"
                >
                  <ArrowDownToLine size={15} />
                </button>
              </div>
            )
          })}
        </div>
      ) : <div className="normative-empty" style={{padding: 20, textAlign: 'center', color: '#8b978e', fontSize: 11}}>Hozircha normativ hujjatlar joylanmagan.</div>}
    </section>
  </div>
}

function ResearcherExpertiseApp({ user, expertiseCases, setExpertiseCases }) {
  const existingCase = expertiseCases.find(c => c.username === user.username) || expertiseCases.find(c => !c.username && c.researcherName === (user.researcherName || user.name))
  const [topic, setTopic] = useState('')
  
  function submitApp(e) {
    e.preventDefault()
    const newCase = {
      id: uid('exp'),
      username: user.username,
      researcherName: user.researcherName || user.name,
      degree: 'PhD',
      field: user.field || 'Noma\'lum',
      topic: topic || user.topic || 'Noma\'lum mavzu',
      supervisor: user.supervisor || 'Noma\'lum rahbar',
      isSupervisorDeptHead: false,
      assignedDepartment: '',
      presidingPerson: '',
      applicationDate: new Date().toISOString().slice(0, 10),
      antiplagiarismScore: 90,
      impactFactorArticlesCount: 0,
      status: 'docs_check',
      documentsStatus: {},
      isKengashAppointed: false,
      hasDirectDefense: false,
    }
    setExpertiseCases((items) => [newCase, ...items])
  }

  const fileInputRef = useRef(null)
  const [activeUploadKey, setActiveUploadKey] = useState(null)
  const [uploadError, setUploadError] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  
  async function handleFileSelect(event) {
    if (!event.target.files.length || !activeUploadKey || !existingCase) return
    const selectedFiles = Array.from(event.target.files)
    const currentFiles = Array.isArray(existingCase.documentsStatus?.[activeUploadKey]) ? existingCase.documentsStatus[activeUploadKey] : []
    
    if (currentFiles.length + selectedFiles.length > 40) {
      setUploadError(`Bitta hujjat bo'limiga ko'pi bilan 40 ta fayl yuklash mumkin.`)
      event.target.value = ''
      return
    }

    setIsUploading(true)
    setUploadError('')
    const validFiles = []
    for (const file of selectedFiles) {
      if (file.size > 20 * 1024 * 1024) {
        setUploadError(`${file.name}: fayl hajmi 20 MB dan oshmasligi kerak.`)
        event.target.value = ''
        setIsUploading(false)
        return
      }
      try {
        const up = await uploadRealFile(file, `Ekspertiza - ${activeUploadKey}`)
        validFiles.push({
          name: file.name,
          size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
          fileUrl: up.fileUrl
        })
      } catch (err) {
        setUploadError(`${file.name}: ${err.message}`)
      }
    }

    const uploadKey = activeUploadKey
    if (validFiles.length) {
      setExpertiseCases((items) => items.map(c => {
        if (c.id !== existingCase.id) return c
        const previous = Array.isArray(c.documentsStatus?.[uploadKey]) ? c.documentsStatus[uploadKey] : []
        return {
          ...c,
          documentsStatus: {
            ...c.documentsStatus,
            [uploadKey]: [...previous, ...validFiles]
          }
        }
      }))
    }
    setIsUploading(false)
    setActiveUploadKey(null)
    event.target.value = ''
  }

  function triggerUpload(key) {
    setActiveUploadKey(key)
    fileInputRef.current?.click()
  }

  if (existingCase) {
    return <div className="portal-content">
      <section className="portal-documents panel">
        <div className="module-toolbar">
          <div><span className="section-kicker">DASTLABKI EKSPERTIZA</span><h2>Sizning arizangiz</h2><p>Hozirgi holat: <strong>{existingCase.status === 'docs_check' ? 'Hujjatlar tekshiruvda' : existingCase.status === 'meeting_scheduled' ? 'Kengash belgilangan' : existingCase.status === 'recommended' ? 'Tavsiya etilgan' : 'Jarayonda'}</strong></p></div>
        </div>
        <div style={{ padding: '0 20px 20px', fontSize: 11, color: '#425248' }}>
          <p><strong>Mavzu:</strong> {existingCase.topic}</p>
          <p><strong>Ilmiy rahbar:</strong> {existingCase.supervisor}</p>
          <p><strong>Ariza sanasi:</strong> {existingCase.applicationDate}</p>
          <br/>
          <p style={{ color: '#8b978e' }}>Admin orqali arizangiz holatini nazorat qiling. Barcha hujjatlar taqdim etilgandan so'ng, Kengash sanasi belgilanadi.</p>
        </div>
      </section>

      <section className="portal-documents panel" style={{ marginTop: 15 }}>
        <div className="module-toolbar">
          <div><span className="section-kicker">TALAB QILINADIGAN HUJJATLAR</span><h2>Nizom hujjatlarini yuklash</h2><p>Quyidagi barcha 11 ta hujjatni .pdf, .docx, .jpg shaklida yuklashingiz kerak</p></div>
        </div>
        <input ref={fileInputRef} type="file" multiple className="visually-hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg" onChange={handleFileSelect} />
        {uploadError && <div className="upload-error" style={{ marginBottom: 15 }}><CircleAlert size={15} />{uploadError}</div>}
        <div className="document-list">
          {REQUIRED_DOCUMENTS.map(doc => {
            const statusVal = existingCase.documentsStatus?.[doc.key]
            const isUploaded = Array.isArray(statusVal) ? statusVal.length > 0 : !!statusVal
            return (
              <div className="document-row" key={doc.key}>
                <span className="document-icon" style={{ color: isUploaded ? '#58a071' : '#9aa49c' }}>
                  {isUploaded ? <Check size={17} /> : <FileText size={17} />}
                </span>
                <span>
                  <strong>{doc.title}</strong>
                  <small>{doc.note}</small>
                  {Array.isArray(statusVal) && statusVal.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      {statusVal.map((f, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => openOrDownloadFile(f.fileUrl || f.url, f.name)}
                          style={{ background: '#eaf4ee', border: 'none', color: '#1a5c37', fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                          title="Yuklab olish / ochish"
                        >
                          <Download size={11} /> {f.name}
                        </button>
                      ))}
                    </div>
                  )}
                </span>
                {isUploaded ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#58a071', fontSize: 10, fontWeight: 600 }}>{Array.isArray(statusVal) ? `${statusVal.length} ta fayl` : 'Yuklangan'}</span>
                    <button className="secondary-button" disabled={isUploading} onClick={() => triggerUpload(doc.key)} title="Yana fayl qo'shish"><Plus size={14} /></button>
                  </div>
                ) : (
                  <button className="secondary-button" disabled={isUploading} onClick={() => triggerUpload(doc.key)}><Upload size={14} />{isUploading ? 'Yuklanmoqda...' : 'Yuklash'}</button>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  }

  return <div className="portal-content">
    <section className="portal-documents panel">
      <div className="module-toolbar">
        <div><span className="section-kicker">DASTLABKI EKSPERTIZA</span><h2>Ariza yaratish</h2><p>Kafedralararo muhokama uchun dastlabki ekspertizaga ariza yuborish</p></div>
      </div>
      <form onSubmit={submitApp} style={{ padding: '0 20px 20px', display: 'grid', gap: '15px' }}>
        <p style={{ fontSize: 11, color: '#647168' }}><strong>{user.researcherName || user.name}</strong> nomidan ekspertiza arizasini ochasiz. Tasdiqlaganingizdan so'ng administrator panelida arizangiz ro'yxatdan o'tadi.</p>
        <label style={{ display: 'grid', gap: 6, fontSize: 10, fontWeight: 600 }}>Dissertatsiya mavzusi
          <input required value={topic} onChange={e => setTopic(e.target.value)} placeholder="Mavzuni to'liq kiriting" style={{ height: 36, padding: '0 10px', borderRadius: 4, border: '1px solid #dce5e0' }} />
        </label>
        <button className="primary-button" style={{ justifySelf: 'flex-start' }} type="submit"><Plus size={16} />Arizani yuborish</button>
      </form>
    </section>
  </div>
}

function AdminMonitoringView({ files, reports, setReports, researchers = [], selectedStage = null, locale = 'uz' }) {
  const [subTab, setSubTab] = useState('ish_reja')
  const [viewedUser, setViewedUser] = useState(null)
  const [stageFilter, setStageFilter] = useState(selectedStage ? String(selectedStage) : 'all')
  const [search, setSearch] = useState('')

  function changeReportStatus(id, newStatus) {
    setReports(reports.map(r => r.id === id ? { ...r, status: newStatus } : r))
  }

  const groupedFiles = Object.values(files.reduce((acc, f) => {
    if (!acc[f.username]) {
      acc[f.username] = { username: f.username, documents: [] }
    }
    acc[f.username].documents.push(f)
    return acc
  }, {}))

  const filteredGrouped = useMemo(() => {
    return groupedFiles.filter(g => {
      const researcher = researchers.find(r => r.username === g.username)
      const name = researcher?.name || g.username
      const matchesSearch = name.toLowerCase().includes(search.toLowerCase()) || g.username.toLowerCase().includes(search.toLowerCase())
      const matchesStage = stageFilter === 'all' || String(researcher?.stage) === stageFilter
      return matchesSearch && matchesStage
    })
  }, [groupedFiles, researchers, search, stageFilter])

  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      const matchesSearch = (r.fio || r.username).toLowerCase().includes(search.toLowerCase())
      const matchesStage = stageFilter === 'all' || String(r.stage) === stageFilter
      return matchesSearch && matchesStage
    })
  }, [reports, search, stageFilter])

  const userDocuments = viewedUser ? files.filter(f => f.username === viewedUser) : []
  const viewedResearcher = viewedUser ? researchers.find(r => r.username === viewedUser) : null

  return (
    <section className="module-view panel" style={{ minHeight: '500px' }}>
      <div className="module-toolbar" style={{ flexWrap: 'wrap', gap: 15 }}>
        <div>
          <span className="section-kicker">MONITORING</span>
          <h2>Izlanuvchilar monitoringi</h2>
          <p>Barcha yuklangan ish reja hujjatlari va choraklik hisobotlar</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 5, background: '#f0f4f2', padding: 3, borderRadius: 6 }}>
            {['all', '1', '2', '3'].map(st => (
              <button
                key={st}
                className={`secondary-button ${stageFilter === st ? 'primary-button' : ''}`}
                style={{ height: 28, minHeight: 28, fontSize: 11, padding: '0 8px' }}
                onClick={() => setStageFilter(st)}
              >
                {st === 'all' ? 'Barcha bosqichlar' : `${st}-bosqich`}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`secondary-button ${subTab === 'ish_reja' ? 'primary-button' : ''}`} style={subTab === 'ish_reja' ? {} : {background: 'transparent', borderColor: '#dce5e0'}} onClick={() => setSubTab('ish_reja')}><FileText size={15} /> Ish reja hujjatlari ({files.length})</button>
            <button className={`secondary-button ${subTab === 'monitoring' ? 'primary-button' : ''}`} style={subTab === 'monitoring' ? {} : {background: 'transparent', borderColor: '#dce5e0'}} onClick={() => setSubTab('monitoring')}><ClipboardCheck size={15} /> Monitoring hisobotlari ({reports.length})</button>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 15px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="search-box" style={{ width: 280 }}>
          <Search size={15} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Izlanuvchi bo‘yicha qidirish..." />
        </div>
      </div>
      
      <div className="table-scroll">
        {subTab === 'ish_reja' ? (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{locale === 'ru' ? 'Соискатель' : locale === 'en' ? 'Researcher' : 'Izlanuvchi'}</th>
                <th>Bosqich</th>
                <th>HUJJATLAR SONI</th>
                <th>{locale === 'ru' ? 'ДЕЙСТВИЯ' : locale === 'en' ? 'ACTIONS' : 'HARAKATLAR'}</th>
              </tr>
            </thead>
            <tbody>
              {filteredGrouped.map((g, i) => {
                const researcher = researchers.find(r => r.username === g.username) || {
                  name: g.username,
                  initials: (g.username || 'IZ').slice(0, 2).toUpperCase(),
                  color: 'blue',
                  stage: 1
                }
                return (
                  <tr key={g.username}>
                    <td>{i + 1}</td>
                    <td>
                      <div className="researcher-cell">
                        <span className={`avatar avatar-${researcher.color || 'blue'}`}>{researcher.initials}</span>
                        <div>
                          <strong>{researcher.name}</strong>
                          <small>login: <code>{g.username}</code></small>
                        </div>
                      </div>
                    </td>
                    <td><span className="status-pill status-inProgress">{researcher.stage}-bosqich</span></td>
                    <td><strong>{g.documents.length} ta</strong> hujjat (punkt)</td>
                    <td>
                      <button className="icon-button" style={{ color: '#0043ce' }} title="Hujjatlarni ko'rish" onClick={() => setViewedUser(g.username)}><Eye size={16} /></button>
                    </td>
                  </tr>
                )
              })}
              {filteredGrouped.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: 30, color: '#8b978e' }}>
                    Mos keluvchi ish reja hujjatlari topilmadi
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>F.I.O.</th>
                <th>{locale === 'ru' ? 'ОРГАНИЗАЦИЯ' : locale === 'en' ? 'ORGANIZATION' : 'TASHKILOT'}</th>
                <th>BOSQICH</th>
                <th>{locale === 'ru' ? 'КВАРТАЛ' : locale === 'en' ? 'QUARTER' : 'CHORAK'}</th>
                <th>HOLAT</th>
                <th>{locale === 'ru' ? 'ДЕЙСТВИЯ' : locale === 'en' ? 'ACTIONS' : 'HARAKATLAR'}</th>
              </tr>
            </thead>
            <tbody>
              {filteredReports.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td><strong>{r.fio || r.username}</strong></td>
                  <td>{r.org}</td>
                  <td>{r.stage}-bosqich</td>
                  <td>{r.quarter}</td>
                  <td>
                    <span className={`status-pill ${r.status === 'Kutilmoqda' ? 'status-needsReview' : r.status === 'Qabul qilindi' ? 'status-inProgress' : 'status-atRisk'}`} 
                          style={r.status === 'Kutilmoqda' ? { backgroundColor: '#ff9800', color: '#fff' } : r.status === 'Rad etildi' ? { backgroundColor: '#da1e28', color: '#fff' } : {}}>
                      {r.status}
                    </span>
                  </td>
                  <td>
                    {r.status === 'Kutilmoqda' ? (
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button className="icon-button" style={{ color: '#58a071' }} title="Qabul qilish" onClick={() => changeReportStatus(r.id, 'Qabul qilindi')}><Check size={16} /></button>
                        <button className="icon-button" style={{ color: '#da1e28' }} title="Rad etish" onClick={() => changeReportStatus(r.id, 'Rad etildi')}><X size={16} /></button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: '#66746b' }}>Ko‘rib chiqilgan</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredReports.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: 30, color: '#8b978e' }}>
                    Mos keluvchi hisobotlar topilmadi
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {viewedUser && (
        <div className="modal-backdrop">
          <section className="researcher-detail-modal" style={{ width: 800 }}>
            <div className="modal-top">
              <div><span className="section-kicker">HUJJATLAR</span><h2>{viewedResearcher?.name || viewedUser} hujjatlari</h2></div>
              <button className="icon-button" onClick={() => setViewedUser(null)}><X size={19}/></button>
            </div>
            <div className="table-scroll" style={{ padding: '0 20px 20px' }}>
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>HUJJAT NOMI</th><th>{locale === 'ru' ? 'ПЕРИОД' : locale === 'en' ? 'PERIOD' : 'DAVR'}</th><th>{locale === 'ru' ? 'ТИП РАБОТЫ' : locale === 'en' ? 'WORK TYPE' : 'ISH TURI'}</th><th>{locale === 'ru' ? 'ФАЙЛ' : locale === 'en' ? 'FILE' : 'FAYL'}</th>
                  </tr>
                </thead>
                <tbody>
                  {userDocuments.map((f, i) => (
                    <tr key={f.id}>
                      <td>{i + 1}</td>
                      <td>{f.name}</td>
                      <td>{f.period}</td>
                      <td>{f.type}</td>
                      <td>
                        {f.files && f.files.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {f.files.map((file, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => openOrDownloadFile(file.fileUrl || file.url, file.name)}
                                className="text-link"
                                style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontSize: 12 }}
                                title="Yuklab olish / ochish"
                              >
                                {file.name} ({file.size})
                              </button>
                            ))}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => f.fileUrl && openOrDownloadFile(f.fileUrl, f.fileName || f.name)}
                            className="text-link"
                            style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: f.fileUrl ? 'pointer' : 'default', fontSize: 12 }}
                            title={f.fileUrl ? "Yuklab olish / ochish" : undefined}
                          >
                            {f.fileName || (locale === 'ru' ? 'Файл' : locale === 'en' ? 'File' : 'Fayl')} {f.size ? `(${f.size})` : ''}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {userDocuments.length === 0 && (
                    <tr><td colSpan="5" style={{ textAlign: 'center', padding: 20, color: '#8b978e' }}>Hujjatlar mavjud emas</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

export default App
