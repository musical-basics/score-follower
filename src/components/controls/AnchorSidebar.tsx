interface Anchor {
    measure: number
    time: number
}

interface AnchorSidebarProps {
    anchors: Anchor[]
    darkMode: boolean
    upsertAnchor?: (measure: number, time: number) => void
    handleDelete?: (measure: number) => void
    handleRestamp?: (measure: number) => void
    handleJumpToMeasure: (time: number) => void
    handleTap: () => void
    handleReset: () => void
    mode: 'PLAYBACK' | 'RECORD'
    currentMeasure: number
    audioCurrentTime?: number // Optional for restamp logic availability
    // New Props for restoring functionality
    handleAudioSelect?: (e: React.ChangeEvent<HTMLInputElement>) => void
    handleXmlSelect?: (e: React.ChangeEvent<HTMLInputElement>) => void
    toggleMode?: () => void
}

// Note: I'm adding functional props here (upsert, delete, etc.) to ensure it actually works 
// like the original sidebar, not just a display.
export function AnchorSidebar({
    anchors, darkMode, upsertAnchor, handleDelete, handleRestamp,
    handleJumpToMeasure, handleTap, handleReset, mode, currentMeasure,
    handleAudioSelect, handleXmlSelect, toggleMode
}: AnchorSidebarProps) {

    // Derived state for rendering ghost measures
    const maxMeasure = anchors.length > 0 ? Math.max(...anchors.map(a => a.measure)) : 0
    const rows = []

    for (let m = 1; m <= maxMeasure; m++) {
        const anchor = anchors.find(a => a.measure === m)
        const isActive = m === currentMeasure

        if (anchor) {
            rows.push(
                <div key={m}
                    className={`flex items-center justify-between p-2 rounded text-xs border ${isActive ? (darkMode ? 'bg-orange-900/30 border-orange-600 ring-1 ring-orange-500/30' : 'bg-orange-50 border-orange-300 ring-1 ring-orange-200') : (darkMode ? 'bg-[#222222] border-slate-700' : 'bg-white border-gray-200')}`}
                    onClick={() => handleJumpToMeasure(anchor.time)}
                >
                    <span className={`font-mono font-bold ${isActive ? 'text-orange-500' : (darkMode ? 'text-slate-300' : 'text-slate-500')}`}>M{m}</span>
                    <div className="flex items-center gap-2">
                        <input
                            type="number" step="0.01"
                            value={anchor.time.toFixed(2)}
                            onChange={(e) => upsertAnchor && upsertAnchor(m, parseFloat(e.target.value))}
                            disabled={mode !== 'RECORD' || m === 1}
                            className={`w-16 text-right border rounded px-1 font-mono ${darkMode ? 'bg-slate-800 border-slate-600 text-emerald-400' : 'bg-white border-gray-300'}`}
                            onClick={e => e.stopPropagation()}
                        />
                        {m !== 1 && mode === 'RECORD' && handleDelete && (
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(m) }} className={`${darkMode ? 'text-slate-500 hover:text-red-400' : 'text-slate-400 hover:text-red-500'}`}>×</button>
                        )}
                    </div>
                </div>
            )
        } else {
            rows.push(
                <div key={m} className={`flex items-center justify-between p-2 rounded text-xs border border-dashed opacity-60 ${darkMode ? 'border-red-800 bg-red-900/20' : 'border-red-200 bg-red-50'}`}>
                    <span className={`font-mono ${darkMode ? 'text-red-400' : 'text-red-400'}`}>M{m} (Ghost)</span>
                    {mode === 'RECORD' && handleRestamp && (
                        <button onClick={() => handleRestamp(m)} className={`text-[10px] px-2 py-0.5 rounded ${darkMode ? 'bg-red-900/50 text-red-400' : 'bg-red-100 text-red-600'}`}>Fix</button>
                    )}
                </div>
            )
        }
    }

    return (
        <aside className={`w-[320px] border-l flex flex-col shadow-xl z-30 transition-colors duration-300 ${darkMode ? 'bg-[#1a1a1a] border-slate-800' : 'bg-white border-gray-300'}`}>

            {/* Playback Controls / Mode Toggle */}
            <div className={`p-4 border-b flex items-center gap-2 ${darkMode ? 'border-slate-800 bg-[#222222]' : 'border-gray-200 bg-gray-50'}`}>
                {toggleMode && (
                    <button
                        onClick={toggleMode}
                        className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${mode === 'RECORD'
                            ? 'bg-red-500 text-white shadow-red-500/20'
                            : 'bg-emerald-500 text-white shadow-emerald-500/20'
                            }`}
                    >
                        {mode === 'RECORD' ? '🔴 REC Mode' : '▶️ PLAY Mode'}
                    </button>
                )}
            </div>

            {/* Inputs */}
            <div className={`p-4 border-b space-y-3 ${darkMode ? 'border-slate-800 bg-[#222222]' : 'border-gray-200 bg-gray-50'}`}>
                {handleAudioSelect && (
                    <div>
                        <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>Audio Source</label>
                        <input type="file" accept="audio/*" onChange={handleAudioSelect} className={`text-xs w-full ${darkMode ? 'text-slate-300' : ''}`} />
                    </div>
                )}
                {handleXmlSelect && (
                    <div>
                        <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>Score XML</label>
                        <input type="file" accept=".xml,.musicxml" onChange={handleXmlSelect} className={`text-xs w-full ${darkMode ? 'text-slate-300' : ''}`} />
                    </div>
                )}
            </div>

            <div className={`p-4 border-b ${darkMode ? 'border-slate-800' : 'border-gray-200'}`}>
                <h2 className={`font-bold text-sm uppercase tracking-wide ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Sync Anchors</h2>
                <p className={`text-xs mt-1 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>{anchors.length} measures mapped</p>
            </div>

            <div className={`flex-1 overflow-y-auto p-2 space-y-1 ${darkMode ? 'bg-[#1a1a1a]' : 'bg-slate-50'}`}>
                {rows}
            </div>

            {/* Footer with Tap/Clear */}
            <div className={`p-4 border-t grid grid-cols-2 gap-2 ${darkMode ? 'border-slate-800 bg-[#222222]' : 'border-gray-200 bg-white'}`}>
                <button onClick={handleReset} disabled={mode !== 'RECORD'} className={`py-2 rounded border text-xs font-bold ${darkMode ? 'border-slate-700 text-slate-400 hover:bg-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>Clear All</button>
                <button onClick={handleTap} disabled={mode !== 'RECORD'} className="py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-lg shadow-indigo-500/20">TAP (A)</button>
            </div>
        </aside>
    )
}
