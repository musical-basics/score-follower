import { useState, useEffect, useRef } from 'react'

interface ModularIslandProps {
    popEffect: boolean
    setPopEffect: (val: boolean) => void
    jumpEffect: boolean
    setJumpEffect: (val: boolean) => void
    glowEffect: boolean
    setGlowEffect: (val: boolean) => void
    darkMode: boolean
    setDarkMode: (val: boolean) => void
    highlightNote: boolean
    setHighlightNote: (val: boolean) => void
    cursorPosition: number
    setCursorPosition: (val: number) => void
    isLocked: boolean
    setIsLocked: (val: boolean) => void
    onDock: () => void
}

export function ModularIsland({
    popEffect, setPopEffect,
    jumpEffect, setJumpEffect,
    glowEffect, setGlowEffect,
    darkMode, setDarkMode,
    highlightNote, setHighlightNote,
    cursorPosition, setCursorPosition,
    isLocked, setIsLocked,
    onDock
}: ModularIslandProps) {
    const [position, setPosition] = useState({ x: window.innerWidth - 320, y: 100 })
    const [isDragging, setIsDragging] = useState(false)
    const dragOffset = useRef({ x: 0, y: 0 })
    const islandRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const savedPos = localStorage.getItem('modularIslandPos')
        if (savedPos) {
            try { setPosition(JSON.parse(savedPos)) } catch (e) { }
        }
    }, [])

    const handleMouseDown = (e: React.MouseEvent) => {
        if (isLocked) return
        setIsDragging(true)
        const rect = islandRef.current?.getBoundingClientRect()
        if (rect) dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging || isLocked) return
        setPosition({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y })
    }

    const handleMouseUp = () => {
        if (isDragging && !isLocked) {
            setIsDragging(false)
            localStorage.setItem('modularIslandPos', JSON.stringify(position))
        }
    }

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove)
            window.addEventListener('mouseup', handleMouseUp)
        } else {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isDragging, isLocked])

    return (
        <div
            ref={islandRef}
            onMouseDown={handleMouseDown}
            className={`fixed z-[2000] flex flex-col gap-2 items-end select-none ${isLocked ? 'cursor-default' : 'cursor-move active:cursor-grabbing'}`}
            style={{ left: position.x, top: position.y, width: 'max-content' }}
        >
            <div className={`
                bg-slate-800/95 backdrop-blur-md text-white p-3 rounded-2xl 
                shadow-2xl border border-slate-600 flex flex-col gap-3 
                transition-transform hover:scale-[1.02] w-[300px]
                ${isDragging ? 'scale-[1.02] ring-2 ring-emerald-500/50' : ''}
            `}>
                {/* Header Row */}
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">
                            Controls
                        </span>

                        {/* LOCK TOGGLE */}
                        <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => setIsLocked(!isLocked)}
                            className={`
                                flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors
                                ${isLocked ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' : 'bg-slate-700 text-slate-400'}
                            `}
                        >
                            {isLocked ? '🔒 Locked' : '🔓 Free'}
                        </button>
                    </div>
                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={onDock}
                        className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-all"
                    >
                        ↘
                    </button>
                </div>

                <div className="h-px w-full bg-slate-600"></div>

                {/* Row 1: Mode & Color */}
                <div className="flex items-center justify-between gap-2">
                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setDarkMode(!darkMode)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${darkMode ? 'bg-slate-600 text-yellow-300' : 'bg-slate-700 text-slate-300'}`}
                    >
                        {darkMode ? '🌙 Dark' : '☀️ Light'}
                    </button>

                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setHighlightNote(!highlightNote)}
                        className={`
                            flex-1 py-1.5 rounded-lg text-xs font-bold transition-all
                            ${highlightNote ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400'}
                        `}
                    >
                        Color
                    </button>
                </div>

                {/* Row 2: FX Toggles */}
                <div className="flex items-center justify-between gap-2">
                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setGlowEffect(!glowEffect)}
                        className={`
                            flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1
                            ${glowEffect ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-400'}
                        `}
                    >
                        ✨ Glow
                    </button>

                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setPopEffect(!popEffect)}
                        className={`
                            flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1
                            ${popEffect ? 'bg-pink-600 text-white' : 'bg-slate-700 text-slate-400'}
                        `}
                    >
                        💥 Pop
                    </button>

                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setJumpEffect(!jumpEffect)}
                        className={`
                            flex-1 py-1.5 rounded-lg text-xs font-bold transition-all
                            ${jumpEffect ? 'bg-orange-500 text-white' : 'bg-slate-700 text-slate-400'}
                        `}
                    >
                        ⤴ Jump
                    </button>
                </div>

                {/* Cursor Slider */}
                <div className={`w-full pt-1 transition-opacity duration-200 ${isLocked ? 'opacity-100' : 'opacity-30 pointer-events-none'}`} onMouseDown={(e) => e.stopPropagation()}>
                    <div className="flex justify-between text-[10px] text-slate-400 mb-1 font-mono">
                        <span>Cursor Anchor</span>
                        <span>{Math.round(cursorPosition * 100)}%</span>
                    </div>
                    <input
                        type="range" min="0.2" max="0.8" step="0.01"
                        value={cursorPosition}
                        onChange={(e) => setCursorPosition(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                </div>
            </div>
        </div>
    )
}

