import { ModularIsland } from '../ModularIsland'

interface ScoreControlsProps {
    viewMode: 'PAGE' | 'SCROLL'
    isIslandMode: boolean
    setIsIslandMode: (val: boolean) => void
    revealMode: 'OFF' | 'NOTE' | 'CURTAIN'
    setRevealMode: (val: 'OFF' | 'NOTE' | 'CURTAIN') => void
    darkMode: boolean
    setDarkMode: (val: boolean) => void
    isLocked: boolean
    setIsLocked: (val: boolean) => void
    highlightNote: boolean
    setHighlightNote: (val: boolean) => void
    glowEffect: boolean
    setGlowEffect: (val: boolean) => void
    popEffect: boolean
    setPopEffect: (val: boolean) => void
    jumpEffect: boolean
    setJumpEffect: (val: boolean) => void
    cursorPosition: number
    setCursorPosition: (val: number) => void
}

export function ScoreControls(props: ScoreControlsProps) {
    const {
        viewMode, isIslandMode, setIsIslandMode,
        revealMode, setRevealMode,
        darkMode, setDarkMode,
        isLocked, setIsLocked,
        highlightNote, setHighlightNote,
        glowEffect, setGlowEffect,
        popEffect, setPopEffect,
        jumpEffect, setJumpEffect,
        cursorPosition, setCursorPosition
    } = props

    // In Page View, we hide these specific scroll controls? 
    // The user prompt said: "If we are in Page View, we might hide these or show a simplified version. if (viewMode === 'PAGE') return null"
    // I will stick to that instruction.
    if (viewMode === 'PAGE') return null

    if (isIslandMode) {
        return <ModularIsland {...props} onDock={() => setIsIslandMode(false)} />
    }

    return (
        <div className={`flex items-center justify-between px-6 py-2 border-b shadow-sm z-40 transition-colors duration-300 ${darkMode ? 'bg-[#2a2a2a] border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>

            {/* Left: Reveal Modes */}
            <div className={`flex items-center gap-1 p-1 rounded-lg ${darkMode ? 'bg-slate-800' : 'bg-slate-200'}`}>
                {(['OFF', 'NOTE', 'CURTAIN'] as const).map(m => (
                    <button
                        key={m}
                        onClick={() => setRevealMode(m)}
                        className={`
                    px-3 py-1 rounded-md text-xs font-bold transition-all
                    ${revealMode === m
                                ? (darkMode ? 'bg-slate-600 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm')
                                : (darkMode ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700')}
                `}
                    >
                        {m === 'OFF' ? 'Normal' : m === 'NOTE' ? 'Note Reveal' : 'Curtain'}
                    </button>
                ))}
            </div>

            {/* Center: Visual Toggles */}
            <div className="flex items-center gap-4">
                <button onClick={() => setDarkMode(!darkMode)} className={`flex items-center gap-2 text-sm font-medium transition-colors ${darkMode ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                    <span>{darkMode ? '🌙' : '☀️'}</span>
                    <span>{darkMode ? 'Dark Mode' : 'Light Mode'}</span>
                </button>

                <div className={`w-px h-4 ${darkMode ? 'bg-slate-700' : 'bg-slate-300'}`}></div>

                <button
                    onClick={() => setIsLocked(!isLocked)}
                    className={`flex items-center gap-2 text-sm font-medium transition-colors ${isLocked ? 'text-emerald-500' : (darkMode ? 'text-slate-500' : 'text-slate-400')}`}
                >
                    <span>{isLocked ? '🔒 Locked' : '🔓 Free'}</span>
                </button>

                <div className={`w-px h-4 ${darkMode ? 'bg-slate-700' : 'bg-slate-300'}`}></div>

                <label className={`flex items-center gap-2 text-sm font-medium cursor-pointer transition-colors ${darkMode ? 'text-slate-300 hover:text-emerald-400' : 'text-slate-700 hover:text-emerald-600'}`}>
                    <input type="checkbox" checked={highlightNote} onChange={e => setHighlightNote(e.target.checked)} className="accent-emerald-500" />
                    Highlight
                </label>

                {/* FX Group */}
                <div className={`flex items-center gap-3 px-3 py-1 rounded border ${darkMode ? 'border-slate-700 bg-slate-800' : 'border-slate-300 bg-slate-200'}`}>
                    <label className="flex items-center gap-1 text-xs font-bold cursor-pointer hover:text-cyan-500">
                        <input type="checkbox" checked={glowEffect} onChange={e => setGlowEffect(e.target.checked)} className="accent-cyan-500" /> Glow
                    </label>
                    <label className="flex items-center gap-1 text-xs font-bold cursor-pointer hover:text-pink-500">
                        <input type="checkbox" checked={popEffect} onChange={e => setPopEffect(e.target.checked)} className="accent-pink-500" /> Pop
                    </label>
                    <label className="flex items-center gap-1 text-xs font-bold cursor-pointer hover:text-orange-500">
                        <input type="checkbox" checked={jumpEffect} onChange={e => setJumpEffect(e.target.checked)} className="accent-orange-500" /> Jump
                    </label>
                </div>
            </div>

            {/* Right: Cursor & Breakout */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>Cursor</span>
                    <input
                        type="range" min="0.2" max="0.8" step="0.01"
                        value={cursorPosition}
                        onChange={e => setCursorPosition(parseFloat(e.target.value))}
                        disabled={!isLocked}
                        className="w-24 h-1.5 bg-slate-300 rounded-lg appearance-none cursor-pointer accent-slate-600"
                    />
                </div>

                <div className={`w-px h-4 ${darkMode ? 'bg-slate-700' : 'bg-slate-300'}`}></div>

                <button
                    onClick={() => setIsIslandMode(true)}
                    title="Detach Controls (Float)"
                    className={`p-1.5 rounded transition-colors ${darkMode ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-900'}`}
                >
                    ↗
                </button>
            </div>
        </div>
    )
}
