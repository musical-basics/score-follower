import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'
import { PageView } from './components/views/PageView'
import { ScrollView } from './components/views/ScrollView'
import { ScoreControls } from './components/controls/ScoreControls'
import { AnchorSidebar } from './components/controls/AnchorSidebar'
import { projectService, type Project } from './services/projectService'

// Legacy Imports
import { ScoreViewer as OldPageView } from './components/_oldComponents/ScoreViewer'
import { ScoreViewerScroll as OldScrollView } from './components/_oldComponents/ScoreViewerScroll'
import { ModularIsland as OldModularIsland } from './components/_oldComponents/ModularIsland'

export interface Anchor {
  measure: number
  time: number
}

export type AppMode = 'PLAYBACK' | 'RECORD'
type ViewMode = 'PAGE' | 'SCROLL'

// Measure 1 always starts at 0:00
const INITIAL_ANCHORS: Anchor[] = [{ measure: 1, time: 0 }]
export const DEFAULT_AUDIO = '/c-major-scale.mp3'
const DEFAULT_XML = '/c-major-exercise.musicxml'

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('PAGE')
  const [revealMode, setRevealMode] = useState<'OFF' | 'NOTE' | 'CURTAIN'>('OFF')
  const [popEffect, setPopEffect] = useState(false)
  const [jumpEffect, setJumpEffect] = useState(true)
  const [glowEffect, setGlowEffect] = useState(true)
  const [isLocked, setIsLocked] = useState(true)
  const [darkMode, setDarkMode] = useState(false)
  const [highlightNote, setHighlightNote] = useState(true)
  const [cursorPosition, setCursorPosition] = useState(0.2)
  const [isIslandMode, setIsIslandMode] = useState(false)

  // Legacy Mode State
  const [legacyMode, setLegacyMode] = useState(false)

  const [anchors, setAnchors] = useState<Anchor[]>(INITIAL_ANCHORS)
  const [mode, setMode] = useState<AppMode>('PLAYBACK')
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const [currentProjectTitle, setCurrentProjectTitle] = useState<string | null>(null)
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false)
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false)

  // File State
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [xmlFile, setXmlFile] = useState<File | null>(null)

  // URL State (drives the player/viewer)
  const [audioUrl, setAudioUrl] = useState<string>(DEFAULT_AUDIO)
  const [xmlUrl, setXmlUrl] = useState<string | undefined>(undefined)

  const [currentMeasure, setCurrentMeasure] = useState<number>(1)

  const audioRef = useRef<HTMLAudioElement>(null)

  // Helper: Find measure based on time
  const getCurrentMeasure = useCallback((time: number) => {
    if (anchors.length === 0) return 1
    const sorted = [...anchors].sort((a, b) => a.time - b.time)
    const anchor = sorted.reverse().find(a => a.time <= time)
    return anchor ? anchor.measure : 1
  }, [anchors])

  // Load projects on mount
  useEffect(() => {
    const init = async () => {
      try {
        const list = await projectService.getProjects()
        setProjects(list)
        const lastId = localStorage.getItem('lastProjectId')
        if (lastId) {
          console.log('Restoring last session:', lastId)
          const lastProject = await projectService.getProjectById(lastId)
          if (lastProject) {
            loadProjectState(lastProject)
          }
        }
      } catch (err) {
        console.error('Initialization failed:', err)
      }
    }
    init()
  }, [])

  // Handle File Selections
  const handleAudioSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setAudioFile(file)
      setAudioUrl(URL.createObjectURL(file))
      setCurrentProjectId(null)
      setCurrentProjectTitle(null)
    }
  }

  const handleXmlSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setXmlFile(file)
      setXmlUrl(URL.createObjectURL(file))
      setCurrentProjectId(null)
      setCurrentProjectTitle(null)
    }
  }

  const fetchFileFromUrl = async (url: string, filename: string): Promise<File> => {
    const response = await fetch(url)
    const blob = await response.blob()
    return new File([blob], filename, { type: blob.type })
  }

  // Save Project
  const handleSaveAs = async () => {
    if (!audioFile && !audioUrl) {
      alert("No audio to save.")
      return
    }

    const title = window.prompt('Enter new project name:')
    if (!title) return

    try {
      let finalAudioFile = audioFile
      let finalXmlFile = xmlFile

      if (!finalAudioFile) {
        console.log('Fetching audio from URL:', audioUrl)
        finalAudioFile = await fetchFileFromUrl(audioUrl, 'audio.mp3')
      }

      if (!finalXmlFile) {
        const urlToFetch = xmlUrl || DEFAULT_XML
        console.log('Fetching XML from URL:', urlToFetch)
        finalXmlFile = await fetchFileFromUrl(urlToFetch, 'score.xml')
      }

      const newProject = await projectService.saveProject(title, finalAudioFile, finalXmlFile, anchors)
      alert('New project created!')
      const updatedProjects = await projectService.getProjects()
      setProjects(updatedProjects)

      setCurrentProjectId(newProject.id)
      setCurrentProjectTitle(newProject.title)
      localStorage.setItem('lastProjectId', newProject.id)
      setIsSaveModalOpen(false)
    } catch (err) {
      console.error(err)
      alert('Failed to create new project. Check console.')
    }
  }

  const handleSave = async () => {
    if (!currentProjectId) return
    try {
      await projectService.updateProject(currentProjectId, anchors)
      alert('Project saved!')
      const updatedProjects = await projectService.getProjects()
      setProjects(updatedProjects)
    } catch (err) {
      console.error(err)
      alert('Failed to update project.')
    }
  }

  const loadProjectState = useCallback((project: Project) => {
    setAudioFile(null)
    setXmlFile(null)
    setAudioUrl(project.audio_url)
    setXmlUrl(project.xml_url)
    setAnchors(project.anchors)
    setCurrentProjectId(project.id)
    setCurrentProjectTitle(project.title)
    setMode('RECORD')
    if (audioRef.current) {
      audioRef.current.currentTime = 0
    }
    localStorage.setItem('lastProjectId', project.id)
  }, [])

  const handleLoadClick = (project: Project) => {
    if (confirm(`Load project "${project.title}" ? Unsaved changes will be lost.`)) {
      loadProjectState(project)
      setIsLoadModalOpen(false)
    }
  }

  const upsertAnchor = (measure: number, time: number) => {
    setAnchors(prev => {
      const filtered = prev.filter(a => a.measure !== measure)
      const newAnchors = [...filtered, { measure, time }]
      return newAnchors.sort((a, b) => a.measure - b.measure)
    })
  }

  const handleDelete = (measureToDelete: number) => {
    if (measureToDelete === 1) {
      alert("Cannot delete the start of the song (Measure 1).")
      return
    }
    setAnchors(prev => prev.filter(a => a.measure !== measureToDelete))
  }

  const handleRestamp = (measureToStamp: number) => {
    if (!audioRef.current) return
    upsertAnchor(measureToStamp, audioRef.current.currentTime)
  }

  const handleTap = useCallback(() => {
    if (mode !== 'RECORD') return
    if (audioRef.current) {
      const currentTime = audioRef.current.currentTime
      setAnchors(prev => [...prev, { measure: prev.length + 1, time: currentTime }])
    }
  }, [mode])

  const handleJumpToMeasure = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time
    }
  }

  const handleReset = useCallback(() => {
    setAnchors(INITIAL_ANCHORS)
  }, [])

  const toggleMode = useCallback(() => {
    setMode(prev => prev === 'RECORD' ? 'PLAYBACK' : 'RECORD')
  }, [])

  const handleSeeked = useCallback(() => {
    if (mode === 'RECORD' && audioRef.current && audioRef.current.currentTime < 0.1 && anchors.length > 1) {
      // Logic removed intentionally
    }
  }, [mode, anchors.length])

  const handleEnded = useCallback(() => {
  }, [])

  const togglePlayPause = useCallback(() => {
    if (audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play()
      } else {
        audioRef.current.pause()
      }
    }
  }, [])

  useEffect(() => {
    // Note: scrollIntoView was handled by refs in the old sidebar code. 
    // In new architecture, we might pass a prop or handle it inside AnchorSidebar.
    // For now, removing the direct ref manipulation here as the elements are in child component.
  }, [currentMeasure])


  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlayPause()
      }
      else if (event.code === 'KeyA') {
        if (mode === 'RECORD') {
          handleTap()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleTap, togglePlayPause, mode])

  return (
    <div className={`flex flex-col h-screen ${darkMode ? 'bg-[#222222] text-[#e0e0e0]' : 'bg-white text-slate-900'}`}>

      {/* 1. MAIN HEADER (Global App Controls) */}
      <div className="flex items-center justify-between px-6 py-3 bg-slate-900 text-white border-b border-slate-800 z-50">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
            Score Follower
          </h1>

          {/* Project Name Badge */}
          <div className="flex items-center px-3 py-1 bg-slate-800 rounded border border-slate-700 text-xs">
            <span className="text-slate-500 mr-2 uppercase tracking-wider font-bold">Project:</span>
            <span className="font-mono text-emerald-400">{currentProjectTitle || 'Untitled'}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">

          {/* Load/Save Group */}
          <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => {
                if (currentProjectId) {
                  handleSave()
                } else {
                  handleSaveAs()
                }
              }}
              className="px-3 py-1.5 bg-slate-700 hover:bg-emerald-600 rounded-l text-xs font-bold transition-all border-r border-slate-600"
            >
              Save
            </button>
            <button
              onClick={() => handleSaveAs()}
              className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-r text-xs font-bold transition-all"
              title="Save As..."
            >
              ▼
            </button>
          </div>

          {/* Load Select */}
          <select
            className="bg-slate-700 text-white px-3 py-1 rounded text-sm border border-slate-600 focus:outline-none focus:border-blue-500 max-w-[150px]"
            onChange={(e) => {
              const proj = projects.find(p => p.id === e.target.value)
              if (proj) handleLoadClick(proj)
              e.target.value = ""
            }}
          >
            <option value="">Load Project...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>

          <div className="w-px h-6 bg-slate-700 mx-2"></div>

          <button onClick={() => setViewMode(v => v === 'PAGE' ? 'SCROLL' : 'PAGE')}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs font-medium border border-slate-700">
            {viewMode === 'PAGE' ? '∞ Scroll View' : '📄 Page View'}
          </button>
          <div className="w-px h-6 bg-slate-700 mx-2"></div>
          <button onClick={() => setLegacyMode(!legacyMode)} className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded border ${legacyMode ? 'bg-amber-500 text-black border-amber-600' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
            {legacyMode ? 'Warning: LEGACY MODE' : 'New Architecture'}
          </button>
        </div>
      </div>

      {/* 2. CONTROLS (Toolbar or Island) */}
      {!legacyMode && (
        <ScoreControls
          viewMode={viewMode}
          isIslandMode={isIslandMode}
          setIsIslandMode={setIsIslandMode}
          revealMode={revealMode}
          setRevealMode={setRevealMode}
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          isLocked={isLocked}
          setIsLocked={setIsLocked}
          highlightNote={highlightNote}
          setHighlightNote={setHighlightNote}
          glowEffect={glowEffect}
          setGlowEffect={setGlowEffect}
          popEffect={popEffect}
          setPopEffect={setPopEffect}
          jumpEffect={jumpEffect}
          setJumpEffect={setJumpEffect}
          cursorPosition={cursorPosition}
          setCursorPosition={setCursorPosition}
        />
      )}

      {/* LEGACY SUBMENU (for Legacy Mode in SCROLL view) */}
      {legacyMode && viewMode === 'SCROLL' && (
        <div className="bg-slate-800 border-b border-slate-700 px-4 py-2 flex items-center gap-3 flex-wrap">
          {/* Mode Toggle */}
          <button onClick={() => setIsIslandMode(!isIslandMode)} className={`px-3 py-1.5 rounded text-xs font-medium border ${isIslandMode ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-slate-700 text-slate-300 border-slate-600'}`}>
            {isIslandMode ? '🏝️ Island Mode' : '📌 Docked'}
          </button>
          <div className="w-px h-6 bg-slate-600"></div>

          {/* Dark Mode */}
          <button onClick={() => setDarkMode(!darkMode)} className={`px-3 py-1.5 rounded text-xs font-medium ${darkMode ? 'bg-slate-600 text-yellow-300' : 'bg-slate-700 text-slate-300'}`}>
            {darkMode ? '🌙 Dark' : '☀️ Light'}
          </button>

          {/* Highlight */}
          <button onClick={() => setHighlightNote(!highlightNote)} className={`px-3 py-1.5 rounded text-xs font-medium ${highlightNote ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
            Color
          </button>

          {/* Glow */}
          <button onClick={() => setGlowEffect(!glowEffect)} className={`px-3 py-1.5 rounded text-xs font-medium ${glowEffect ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
            ✨ Glow
          </button>

          {/* Pop */}
          <button onClick={() => setPopEffect(!popEffect)} className={`px-3 py-1.5 rounded text-xs font-medium ${popEffect ? 'bg-pink-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
            💥 Pop
          </button>

          {/* Jump */}
          <button onClick={() => setJumpEffect(!jumpEffect)} className={`px-3 py-1.5 rounded text-xs font-medium ${jumpEffect ? 'bg-orange-500 text-white' : 'bg-slate-700 text-slate-400'}`}>
            ⤴ Jump
          </button>

          {/* Lock */}
          <button onClick={() => setIsLocked(!isLocked)} className={`px-3 py-1.5 rounded text-xs font-bold ${isLocked ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' : 'bg-slate-700 text-slate-400'}`}>
            {isLocked ? '🔒 Locked' : '🔓 Free'}
          </button>

          {/* Cursor Slider */}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[10px] text-slate-400 font-mono">Cursor: {Math.round(cursorPosition * 100)}%</span>
            <input type="range" min="0.2" max="0.8" step="0.01" value={cursorPosition} onChange={(e) => setCursorPosition(parseFloat(e.target.value))} className="w-24 h-1.5 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-cyan-400" />
          </div>
        </div>
      )}

      {/* 3. MAIN CONTENT */}
      <div className="flex-1 flex overflow-hidden">

        {/* Score Area */}
        <div className="flex-1 relative overflow-hidden flex flex-col">
          {viewMode === 'PAGE' ? (
            legacyMode ? (
              <OldPageView audioRef={audioRef} anchors={anchors} mode={mode} musicXmlUrl={xmlUrl || DEFAULT_XML} />
            ) : (
              <PageView audioRef={audioRef} anchors={anchors} mode={mode} musicXmlUrl={xmlUrl || DEFAULT_XML} />
            )
          ) : (
            legacyMode ? (
              <OldScrollView
                audioRef={audioRef} anchors={anchors} mode={mode} musicXmlUrl={xmlUrl || DEFAULT_XML}
                revealMode={revealMode} popEffect={popEffect} darkMode={darkMode}
                glowEffect={glowEffect} jumpEffect={jumpEffect}
                highlightNote={highlightNote} cursorPosition={cursorPosition} isLocked={isLocked}
              />
            ) : (
              <ScrollView
                audioRef={audioRef} anchors={anchors} mode={mode} musicXmlUrl={xmlUrl || DEFAULT_XML}
                revealMode={revealMode} popEffect={popEffect} darkMode={darkMode}
                glowEffect={glowEffect}
                jumpEffect={jumpEffect}
                highlightNote={highlightNote} cursorPosition={cursorPosition}
                isLocked={isLocked}
              />
            )
          )}

          {/* MODULAR ISLAND (Only visible if isIslandMode is TRUE) */}
          {/* Support Legacy Island too if needed, but the main goal is comparing core scrolling behavior. 
              The user asked 'hook this up to the app view'. 
              If legacyMode is ON, we might want the old island if in SCROLL mode.
              However, the 'OldModularIsland' was built to work with 'OldScrollView' via props? 
              Actually, the OldModularIsland took setPopEffect etc. 
              If we want FULL parity, we should render OldModularIsland if legacyMode is on.
          */}
          {viewMode === 'SCROLL' && isIslandMode && (
            legacyMode ? (
              <OldModularIsland
                popEffect={popEffect} setPopEffect={setPopEffect}
                glowEffect={glowEffect} setGlowEffect={setGlowEffect}
                jumpEffect={jumpEffect} setJumpEffect={setJumpEffect}
                darkMode={darkMode} setDarkMode={setDarkMode}
                highlightNote={highlightNote} setHighlightNote={setHighlightNote}
                cursorPosition={cursorPosition} setCursorPosition={setCursorPosition}
                isLocked={isLocked} setIsLocked={setIsLocked}
                onDock={() => setIsIslandMode(false)}
              />
            ) : (
              <ScoreControls
                viewMode={viewMode}
                isIslandMode={isIslandMode}
                setIsIslandMode={setIsIslandMode}
                revealMode={revealMode}
                setRevealMode={setRevealMode}
                darkMode={darkMode}
                setDarkMode={setDarkMode}
                isLocked={isLocked}
                setIsLocked={setIsLocked}
                highlightNote={highlightNote}
                setHighlightNote={setHighlightNote}
                glowEffect={glowEffect}
                setGlowEffect={setGlowEffect}
                popEffect={popEffect}
                setPopEffect={setPopEffect}
                jumpEffect={jumpEffect}
                setJumpEffect={setJumpEffect}
                cursorPosition={cursorPosition}
                setCursorPosition={setCursorPosition}
              />
            )
          )}
        </div>

        {/* Sidebar (Sync Anchors) */}
        <AnchorSidebar
          anchors={anchors}
          darkMode={darkMode}
          upsertAnchor={upsertAnchor}
          handleDelete={handleDelete}
          handleRestamp={handleRestamp}
          handleJumpToMeasure={handleJumpToMeasure}
          handleTap={handleTap}
          handleReset={handleReset}
          mode={mode}
          currentMeasure={currentMeasure}
          handleAudioSelect={handleAudioSelect}
          handleXmlSelect={handleXmlSelect}
          toggleMode={toggleMode}
        />

      </div>

      {/* Global Footer (Audio Player) */}
      <footer className="bg-slate-900 border-t border-slate-800 p-3 z-50">
        <audio
          ref={audioRef} controls src={audioUrl}
          className="w-full h-8"
          onSeeked={handleSeeked}
          onEnded={handleEnded}
          onTimeUpdate={() => {
            if (audioRef.current && anchors.length > 0) {
              const m = getCurrentMeasure(audioRef.current.currentTime)
              if (m !== currentMeasure) setCurrentMeasure(m)
            }
          }}
        />
      </footer>
    </div>
  )
}

export default App
