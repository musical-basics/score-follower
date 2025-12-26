import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'
import { ScoreViewer } from './components/ScoreViewer'
import { projectService, type Project } from './services/projectService'

interface Anchor {
  measure: number
  time: number
}

export type AppMode = 'RECORD' | 'PLAYBACK'

// Measure 1 always starts at 0:00
const INITIAL_ANCHORS: Anchor[] = [{ measure: 1, time: 0 }]
const DEFAULT_AUDIO = '/c-major-exercise.mp3'
// Default XML handles by ScoreViewer if undefined, but for saving we need to know what to save
const DEFAULT_XML = '/c-major-exercise.musicxml'

function App() {
  const [anchors, setAnchors] = useState<Anchor[]>(INITIAL_ANCHORS)
  const [mode, setMode] = useState<AppMode>('RECORD')
  const [projects, setProjects] = useState<Project[]>([])

  // File State
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [xmlFile, setXmlFile] = useState<File | null>(null)

  // URL State (drives the player/viewer)
  const [audioUrl, setAudioUrl] = useState<string>(DEFAULT_AUDIO)
  const [xmlUrl, setXmlUrl] = useState<string | undefined>(undefined) // undefined uses default inside Viewer

  const audioRef = useRef<HTMLAudioElement>(null)
  const anchorListRef = useRef<HTMLDivElement>(null)

  // Load projects on mount
  useEffect(() => {
    projectService.getProjects().then(setProjects).catch(console.error)
  }, [])

  // Handle File Selections
  const handleAudioSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setAudioFile(file)
      setAudioUrl(URL.createObjectURL(file))
    }
  }

  const handleXmlSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setXmlFile(file)
      setXmlUrl(URL.createObjectURL(file))
    }
  }

  // Save Project
  const handleSave = async () => {
    const title = window.prompt('Enter project name:')
    if (!title) return

    try {
      // Determine what to save
      // If user provided files, use them.
      // If not, fetch the current URL as a blob (handling default/remote assets)

      let finalAudioFile = audioFile
      let finalXmlFile = xmlFile

      // Helper to fetch valid file from URL
      const fetchFileFromUrl = async (url: string, filename: string): Promise<File> => {
        const response = await fetch(url)
        const blob = await response.blob()
        return new File([blob], filename, { type: blob.type })
      }

      if (!finalAudioFile) {
        console.log('Fetching audio from URL:', audioUrl)
        finalAudioFile = await fetchFileFromUrl(audioUrl, 'audio.mp3')
      }

      if (!finalXmlFile) {
        // use xmlUrl or default
        const urlToFetch = xmlUrl || DEFAULT_XML
        console.log('Fetching XML from URL:', urlToFetch)
        finalXmlFile = await fetchFileFromUrl(urlToFetch, 'score.xml')
      }

      await projectService.saveProject(title, finalAudioFile, finalXmlFile, anchors)
      alert('Project saved successfully!')
      // Refresh list
      const updatedProjects = await projectService.getProjects()
      setProjects(updatedProjects)
    } catch (err) {
      console.error(err)
      alert('Failed to save project. Check console.')
    }
  }

  // Load Project
  const handleLoad = (project: Project) => {
    if (confirm(`Load project "${project.title}"? Unsaved changes will be lost.`)) {
      setAudioFile(null) // Clear file inputs as we are using URLs now
      setXmlFile(null)

      setAudioUrl(project.audio_url)
      setXmlUrl(project.xml_url)
      setAnchors(project.anchors)

      // Reset to Loaded/Record state
      setMode('RECORD')
      // handleReset() removed because it wipes the anchors we just loaded!

      // We should probably seek audio to 0
      if (audioRef.current) {
        audioRef.current.currentTime = 0
      }
    }
  }

  // Add this helper to insert/update an anchor while keeping the array sorted
  const upsertAnchor = (measure: number, time: number) => {
    setAnchors(prev => {
      // Remove existing anchor for this measure if it exists
      const filtered = prev.filter(a => a.measure !== measure)
      // Add the new one
      const newAnchors = [...filtered, { measure, time }]
      // Sort by measure number to keep the list clean
      return newAnchors.sort((a, b) => a.measure - b.measure)
    })
  }

  // The Delete Handler
  const handleDelete = (measureToDelete: number) => {
    if (measureToDelete === 1) {
      alert("Cannot delete the start of the song (Measure 1).")
      return
    }
    setAnchors(prev => prev.filter(a => a.measure !== measureToDelete))
  }

  // The "Restamp" Handler (for the ghost row)
  const handleRestamp = (measureToStamp: number) => {
    if (!audioRef.current) return
    upsertAnchor(measureToStamp, audioRef.current.currentTime)
  }

  const handleTap = useCallback(() => {
    // Only allow tapping in RECORD mode
    if (mode !== 'RECORD') return

    if (audioRef.current) {
      const currentTime = audioRef.current.currentTime
      // Next measure number is current length + 1 (since we start with Measure 1)
      setAnchors(prev => [...prev, { measure: prev.length + 1, time: currentTime }])
    }
  }, [mode])

  // Reset anchors to start fresh (but keep Measure 1 at 0)
  const handleReset = useCallback(() => {
    setAnchors(INITIAL_ANCHORS)
  }, [])



  // Toggle between RECORD and PLAYBACK modes
  const toggleMode = useCallback(() => {
    setMode(prev => prev === 'RECORD' ? 'PLAYBACK' : 'RECORD')
  }, [])

  // Auto-reset when audio is seeked to beginning (only in RECORD mode)
  const handleSeeked = useCallback(() => {
    // Check if we have more than the initial anchor to avoid infinite loops or unneeded resets
    // Also check if we are significantly close to 0
    if (mode === 'RECORD' && audioRef.current && audioRef.current.currentTime < 0.1 && anchors.length > 1) {
      // Only reset if we manually seeked to 0? 
      // The original logic was: reset anchors if seeked to 0.
      // But if I load a project, I set anchors, and seek to 0. I don't want to wipe them.
      // Fix: Only reset if we are NOT loading? 
      // Better: Just manual clear. Auto-clear on seek is annoying if I just want to replay what I recorded.
      // Let's REMOVE the auto-reset on seek feature for now as it conflicts with Loading.
      // Or keep it but strictly checking user intent? Hard. Removing for safety.
      // User can use "Clear" button.
    }
  }, [mode, anchors.length]) // eslint-disable-line

  const handleEnded = useCallback(() => {
    // Optionally reset when audio ends
  }, [])

  // Auto-scroll to newest anchor
  useEffect(() => {
    if (anchorListRef.current && anchors.length > 0) {
      anchorListRef.current.scrollTop = anchorListRef.current.scrollHeight
    }
  }, [anchors])

  // Handle spacebar press
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if typing in an input
      if (event.target instanceof HTMLInputElement) return

      if (event.code === 'Space' && event.target === document.body) {
        event.preventDefault() // Prevent scrolling
        handleTap()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleTap])

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Top Header */}
      <header className="bg-slate-800 text-white py-4 px-6 shadow-lg flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold tracking-wide">Score Follower</h1>

          {/* Save Button */}
          <button
            onClick={handleSave}
            // Enable save if we have new files OR if we are using default/url assets (which we always are)
            // Ideally we disable if "loading", but for now always enabled is better than always disabled.
            // But let's check if we have something valid. We always have defaults.
            className={'px-3 py-1 rounded text-sm font-semibold transition-colors bg-blue-600 hover:bg-blue-700'}
          >
            Save Project
          </button>

          {/* Load Dropdown */}
          <select
            className="bg-slate-700 text-white px-3 py-1 rounded text-sm border border-slate-600 focus:outline-none focus:border-blue-500"
            onChange={(e) => {
              const proj = projects.find(p => p.id === e.target.value)
              if (proj) handleLoad(proj)
              e.target.value = "" // Reset selection
            }}
          >
            <option value="">Load Project...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.title} ({new Date(p.created_at).toLocaleDateString()})
              </option>
            ))}
          </select>
        </div>

        {/* Mode Toggle Button */}
        <button
          onClick={toggleMode}
          className={`px-4 py-2 rounded-lg font-semibold transition-all duration-200 ${mode === 'RECORD'
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : 'bg-emerald-500 hover:bg-emerald-600 text-white'
            }`}
        >
          {mode === 'RECORD' ? '🔴 RECORD Mode' : '▶️ PLAYBACK Mode'}
        </button>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Score Container - Main Content */}
        <main
          id="score-container"
          className="flex-grow bg-gray-100 overflow-auto relative"
        >
          <ScoreViewer
            audioRef={audioRef}
            anchors={anchors}
            mode={mode}
            musicXmlUrl={xmlUrl}
          />
        </main>

        {/* Right Sidebar - Sync Anchors */}
        <aside className="w-[320px] bg-white border-l border-gray-300 flex flex-col shadow-xl z-10">

          {/* Project Configuration Section */}
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">
              Project Files
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Audio File (.mp3, .wav)</label>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleAudioSelect}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Sheet Music (.xml, .musicxml)</label>
                <input
                  type="file"
                  accept=".xml,.musicxml"
                  onChange={handleXmlSelect}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
              </div>
            </div>
          </div>

          {/* Anchors List */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center bg-white">
              <h2 className="text-lg font-semibold text-gray-800">
                Sync Anchors
              </h2>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                {anchors.length} measures
              </span>
            </div>

            <div
              ref={anchorListRef}
              className="flex-1 overflow-y-auto p-4 space-y-2"
            >
              {(() => {
                if (anchors.length === 0) return null

                // Find the highest measure number we know about
                const maxMeasure = Math.max(...anchors.map(a => a.measure))
                const rows = []

                // Loop through 1 to MaxMeasure
                for (let m = 1; m <= maxMeasure; m++) {
                  const anchor = anchors.find(a => a.measure === m)
                  const isMeasureOne = m === 1

                  if (anchor) {
                    // === RENDER EXISTING ANCHOR ===
                    rows.push(
                      <div key={m} className="border rounded-md px-3 py-2 text-sm flex items-center justify-between bg-white border-gray-200">
                        <span className="font-medium text-gray-600">Measure {m}:</span>

                        <div className="flex items-center gap-2">
                          {/* Time Display/Input */}
                          <input
                            type="number"
                            step="0.01"
                            value={anchor.time.toFixed(2)}
                            onChange={(e) => upsertAnchor(m, parseFloat(e.target.value))}
                            disabled={mode !== 'RECORD' || isMeasureOne}
                            className="w-16 text-right font-mono border rounded px-1"
                          />
                          <span className="text-gray-400 text-xs">s</span>

                          {/* Delete Button (X) */}
                          {!isMeasureOne && mode === 'RECORD' && (
                            <button
                              onClick={() => handleDelete(m)}
                              className="ml-2 text-gray-400 hover:text-red-500 font-bold px-2"
                              title="Un-sync this measure"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  } else {
                    // === RENDER "GHOST" ROW (Missing Anchor) ===
                    rows.push(
                      <div key={m} className="border border-dashed border-red-300 bg-red-50 rounded-md px-3 py-2 text-sm flex items-center justify-between">
                        <span className="font-medium text-red-400">Measure {m}</span>

                        {mode === 'RECORD' ? (
                          <button
                            onClick={() => handleRestamp(m)}
                            className="text-xs bg-red-100 text-red-600 border border-red-200 px-2 py-1 rounded hover:bg-red-200 transition-colors"
                          >
                            📍 Set to Current Time
                          </button>
                        ) : (
                          <span className="text-xs text-red-300 italic">Not Synced</span>
                        )}
                      </div>
                    )
                  }
                }
                return rows
              })()}
            </div>
          </div>
        </aside>
      </div>

      {/* Bottom Fixed Footer */}
      <footer className="bg-slate-900 border-t border-slate-700 p-4 flex items-center gap-6 shadow-2xl z-20">
        {/* Audio Element */}
        <audio
          ref={audioRef}
          controls
          className="flex-grow h-10 rounded"
          src={audioUrl}
          onSeeked={handleSeeked}
          onEnded={handleEnded}
        >
          Your browser does not support the audio element.
        </audio>

        {/* Clear/Reset Button */}
        <button
          onClick={handleReset}
          disabled={mode !== 'RECORD'}
          className={`font-semibold px-6 py-3 rounded-lg shadow transition-all duration-150 ${mode === 'RECORD'
            ? 'bg-slate-700 hover:bg-slate-600 text-white border border-slate-600'
            : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-800'
            }`}
        >
          Clear
        </button>

        {/* TAP Button */}
        <button
          onClick={handleTap}
          disabled={mode !== 'RECORD'}
          className={`font-bold text-xl px-12 py-3 rounded-lg shadow-lg border border-transparent transition-all duration-150 transform ${mode === 'RECORD'
            ? 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white hover:scale-105 active:scale-95 shadow-indigo-500/30'
            : 'bg-slate-800 text-slate-600 cursor-not-allowed border-slate-800'
            }`}
        >
          TAP
        </button>
      </footer>
    </div>
  )
}

export default App
