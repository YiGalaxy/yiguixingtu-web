import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { advancePlayback } from '~/utils/playMode'
import { parseId3v2Cover } from '~/utils/id3'

const VOLUME_STORAGE_KEY = 'bg-music-volume'
const ID3_HEAD_BYTES = 131072
const PROGRESS_MIN_INTERVAL = 250
const PROGRESS_MIN_DELTA = 1

/** Owns the single audio element in app.vue and exposes its controls to pages. */
export const useGlobalMusicPlayer = (music) => {
  const { enabled, report } = music
  const { tracks, currentTrack, activeIndex } = useMusicTracks()
  const src = computed(() => currentTrack.value.url)
  const audioRef = ref()
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(1)
  const muted = ref(false)
  const coverUrl = ref('')
  let shuffleBag = []
  let lastProgressAt = 0
  let lastProgressValue = 0
  let coverAttemptedFor = ''

  const readStoredVolume = () => {
    if (!import.meta.client) return 1
    try {
      const saved = Number.parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY) ?? '')
      return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 1
    } catch {
      return 1
    }
  }

  const persistVolume = () => {
    if (!import.meta.client) return
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(volume.value))
    } catch {
      // Playback still uses the in-memory volume.
    }
  }

  const applyVolume = () => {
    const el = audioRef.value
    if (!el) return
    el.volume = volume.value
    el.muted = muted.value
  }

  const setVolume = (value) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return
    volume.value = Math.min(1, Math.max(0, parsed))
    if (volume.value > 0) muted.value = false
    applyVolume()
    persistVolume()
  }

  const toggleMute = () => {
    muted.value = !muted.value
    applyVolume()
  }

  const progressOf = (el) => (el && el.duration ? (el.currentTime / el.duration) * 100 : 0)

  const seek = (seconds) => {
    const el = audioRef.value
    const target = Number(seconds)
    if (!el || !Number.isFinite(target)) return
    const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : target
    el.currentTime = Math.min(Math.max(0, target), max)
    currentTime.value = el.currentTime
    report({ progress: progressOf(el) })
  }

  const onDuration = () => {
    const seconds = audioRef.value?.duration
    if (Number.isFinite(seconds) && seconds > 0) duration.value = seconds
  }

  const onTime = () => {
    const el = audioRef.value
    if (!el) return
    if (duration.value <= 0) onDuration()
    if (Number.isFinite(el.currentTime)) currentTime.value = el.currentTime
    const percent = progressOf(el)
    if (!Number.isFinite(percent)) return
    const now = Date.now()
    if (now - lastProgressAt < PROGRESS_MIN_INTERVAL
      && Math.abs(percent - lastProgressValue) < PROGRESS_MIN_DELTA) return
    lastProgressAt = now
    lastProgressValue = percent
    report({ progress: percent })
  }

  const onPlay = () => report({ playing: true })
  const onPause = () => report({ playing: false })

  watch([music.mode, () => tracks.value.length], () => { shuffleBag = [] })

  const onEnded = async () => {
    report({ playing: false, progress: 0 })
    const el = audioRef.value
    const { index, bag } = advancePlayback({
      mode: music.mode.value,
      current: activeIndex.value,
      total: tracks.value.length,
      bag: shuffleBag,
    })
    shuffleBag = bag
    if (!el) return
    if (index == null) {
      music.setEnabled(false)
      el.currentTime = 0
      currentTime.value = 0
      music.setTrack(0)
      return
    }
    if (index === activeIndex.value) {
      currentTime.value = 0
      el.currentTime = 0
      try {
        await el.play()
        report({ playing: true })
      } catch {
        report({ playing: false })
      }
      return
    }
    music.setTrack(index)
  }

  const onVolumeChange = () => {
    const el = audioRef.value
    if (!el) return
    if (Number.isFinite(el.volume)) volume.value = el.volume
    muted.value = el.muted === true
  }

  const isSameOrigin = (url) => {
    if (typeof url !== 'string' || !url) return false
    if (url.startsWith('/')) return true
    if (!import.meta.client) return false
    try {
      return new URL(url, window.location.href).origin === window.location.origin
    } catch {
      return false
    }
  }

  const resetCover = () => {
    if (coverUrl.value) {
      try {
        URL.revokeObjectURL(coverUrl.value)
      } catch {
        // The URL may already have been released.
      }
    }
    coverUrl.value = ''
    coverAttemptedFor = ''
  }

  const fetchCover = async () => {
    if (!import.meta.client) return
    const trackSrc = src.value
    if (!trackSrc || coverAttemptedFor === trackSrc || !isSameOrigin(trackSrc)) return
    coverAttemptedFor = trackSrc
    try {
      const head = await $fetch(trackSrc, {
        headers: { Range: `bytes=0-${ID3_HEAD_BYTES - 1}` },
        responseType: 'arrayBuffer',
      })
      const cover = parseId3v2Cover(head)
      if (!cover || coverAttemptedFor !== trackSrc) return
      if (typeof URL?.createObjectURL !== 'function') return
      coverUrl.value = URL.createObjectURL(cover.blob)
    } catch {
      // An unavailable embedded cover does not affect playback.
    }
  }

  watch([enabled, src], async ([on, trackSrc], previous) => {
    const el = audioRef.value
    if (!el) return
    if (!previous || previous[1] !== trackSrc) {
      currentTime.value = 0
      duration.value = 0
      resetCover()
      report({ progress: 0 })
      await nextTick()
      el.currentTime = 0
    }
    if (!on) {
      el.pause()
      report({ playing: false })
      return
    }
    try {
      await el.play()
      report({ playing: true })
    } catch {
      report({ playing: false })
    }
    fetchCover()
  })

  onMounted(() => {
    volume.value = readStoredVolume()
    applyVolume()
  })
  onBeforeUnmount(resetCover)

  provide('bgMusicPlayer', {
    audioRef, currentTime, duration, volume, muted, coverUrl,
    seek, setVolume, toggleMute,
  })

  return { audioRef, src, onTime, onDuration, onPlay, onPause, onEnded, onVolumeChange }
}
