import { useEffect, useRef, useCallback, useState } from 'react'
import { OpenSheetMusicDisplay as OSMD } from 'opensheetmusicdisplay'
import type { AppMode } from '../App'

interface Anchor {
    measure: number
    time: number
}

interface ScoreViewerProps {
    audioRef: React.RefObject<HTMLAudioElement | null>
    anchors: Anchor[]
    mode: AppMode
    musicXmlUrl?: string
    revealMode: 'OFF' | 'NOTE' | 'CURTAIN' // Updated Prop Type
}

type NoteData = {
    id: string
    measureIndex: number
    timestamp: number
    element: HTMLElement | null
}

export function ScoreViewerScroll({ audioRef, anchors, mode, musicXmlUrl, revealMode }: ScoreViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const cursorRef = useRef<HTMLDivElement>(null)
    const curtainRef = useRef<HTMLDivElement>(null) // For Curtain Mode
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    // Start at -1 so checks fire on the first frame
    const lastMeasureIndexRef = useRef<number>(-1)
    const prevRevealModeRef = useRef<'OFF' | 'NOTE' | 'CURTAIN'>('OFF')

    const osmdRef = useRef<OSMD | null>(null)
    const [isLoaded, setIsLoaded] = useState(false)
    const animationFrameRef = useRef<number | null>(null)

    // Maps for "Note Reveal" mode
    const noteMap = useRef<Map<number, NoteData[]>>(new Map())
    const measureContentMap = useRef<Map<number, HTMLElement[]>>(new Map())

    // === 1. BUILD MAPS (Used for Karaoke AND Note Reveal) ===
    const calculateNoteMap = useCallback(() => {
        const osmd = osmdRef.current
        if (!osmd || !osmd.GraphicSheet || !containerRef.current) return

        console.log('[ScoreViewerScroll] Building Spatial Maps...')
        const newNoteMap = new Map<number, NoteData[]>()
        const newMeasureContentMap = new Map<number, HTMLElement[]>()

        const measureList = osmd.GraphicSheet.MeasureList
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unitInPixels = (osmd.GraphicSheet as any).UnitInPixels || 10

        // A. Calculate Measure Boundaries
        const measureBounds: { index: number, left: number, right: number }[] = []
        measureList.forEach((staves, index) => {
            const measureNumber = index + 1
            let minX = Number.MAX_VALUE, maxX = Number.MIN_VALUE
            staves.forEach(staff => {
                const pos = staff.PositionAndShape
                const absX = pos.AbsolutePosition.x
                const left = absX + pos.BorderLeft
                const right = absX + pos.BorderRight
                if (left < minX) minX = left
                if (right > maxX) maxX = right
            })
            if (minX < Number.MAX_VALUE) {
                measureBounds.push({ index: measureNumber, left: minX * unitInPixels, right: maxX * unitInPixels })
            }
        })

        // B. Note Map (For Timing/Highlighting)
        measureList.forEach((measureStaves, measureIndex) => {
            const measureNumber = measureIndex + 1
            const measureNotes: NoteData[] = []
            if (!measureStaves) return

            measureStaves.forEach(staffMeasure => {
                const measurePos = staffMeasure.PositionAndShape
                const measureWidth = (measurePos.BorderRight - measurePos.BorderLeft) * unitInPixels
                staffMeasure.staffEntries.forEach(entry => {
                    const graphicalVoiceEntries = entry.graphicalVoiceEntries
                    if (!graphicalVoiceEntries) return
                    const relX = entry.PositionAndShape.RelativePosition.x * unitInPixels
                    const relativeTimestamp = relX / measureWidth
                    graphicalVoiceEntries.forEach(gve => {
                        if (!gve.notes) return
                        gve.notes.forEach(note => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const internalNote = note as any
                            if (internalNote.vfnote && internalNote.vfnote.length > 0) {
                                const vfStaveNote = internalNote.vfnote[0]
                                const vfId = vfStaveNote.attrs ? vfStaveNote.attrs.id : null
                                if (vfId) {
                                    let element = document.getElementById(vfId)
                                    if (!element) element = document.getElementById(`vf-${vfId}`)
                                    if (element) {
                                        const group = element.closest('.vf-stavenote') || element
                                        measureNotes.push({
                                            id: vfId,
                                            measureIndex: measureNumber,
                                            timestamp: relativeTimestamp,
                                            element: group as HTMLElement
                                        })
                                    }
                                }
                            }
                        })
                    })
                })
            })
            if (measureNotes.length > 0) newNoteMap.set(measureNumber, measureNotes)
        })

        // C. Content Map (For "Note Reveal" Visibility)
        const selector = '.vf-stavenote, .vf-beam, .vf-rest, .vf-accidental, .vf-modifier'
        const allElements = Array.from(containerRef.current.querySelectorAll(selector))
        allElements.forEach(el => {
            const rect = el.getBoundingClientRect()
            const containerRect = containerRef.current!.getBoundingClientRect()
            const elCenterX = (rect.left - containerRect.left) + (rect.width / 2)
            const match = measureBounds.find(b => elCenterX >= b.left - 10 && elCenterX <= b.right + 10)
            if (match) {
                if (!newMeasureContentMap.has(match.index)) newMeasureContentMap.set(match.index, [])
                newMeasureContentMap.get(match.index)!.push(el as HTMLElement)
            }
        })

        noteMap.current = newNoteMap
        measureContentMap.current = newMeasureContentMap
    }, [])

    // ... (Init Effect - Standard)
    useEffect(() => {
        if (!containerRef.current || osmdRef.current) return
        const osmd = new OSMD(containerRef.current, {
            autoResize: true, followCursor: false, drawTitle: true, drawSubtitle: false,
            drawComposer: false, drawCredits: false, drawPartNames: true, drawMeasureNumbers: true,
            renderSingleHorizontalStaffline: true
        })
        osmdRef.current = osmd
        const xmlUrl = musicXmlUrl || '/c-major-exercise.musicxml'
        osmd.load(xmlUrl).then(() => {
            osmd.render()
            setTimeout(() => { osmd.render(); calculateNoteMap() }, 100)
            calculateNoteMap()
            setIsLoaded(true)
        }).catch((err) => console.error(err))
        return () => { osmdRef.current = null; setIsLoaded(false) }
    }, [musicXmlUrl, calculateNoteMap])

    // ... (Resize Effect - Standard)
    useEffect(() => {
        const handleResize = () => setTimeout(() => calculateNoteMap(), 500)
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [calculateNoteMap])

    // ... (Find Measure Helper - Standard)
    const findCurrentMeasure = useCallback((time: number) => {
        if (anchors.length === 0) return { measure: 1, progress: 0 }
        const sortedAnchors = [...anchors].sort((a, b) => a.time - b.time)
        let currentMeasure = 1, measureStartTime = 0, measureEndTime = Infinity
        for (let i = 0; i < sortedAnchors.length; i++) {
            const anchor = sortedAnchors[i]
            if (time >= anchor.time) {
                currentMeasure = anchor.measure; measureStartTime = anchor.time
                if (i + 1 < sortedAnchors.length) measureEndTime = sortedAnchors[i + 1].time
                else measureEndTime = Infinity
            } else break
        }
        let progress = 0
        if (measureEndTime !== Infinity && measureEndTime > measureStartTime) {
            progress = (time - measureStartTime) / (measureEndTime - measureStartTime)
            progress = Math.max(0, Math.min(1, progress))
        }
        return { measure: currentMeasure, progress }
    }, [anchors])

    // Helper: Coloring
    const applyColor = (element: HTMLElement, color: string) => {
        const paths = element.getElementsByTagName('path')
        for (let i = 0; i < paths.length; i++) {
            paths[i].setAttribute('fill', color)
            paths[i].setAttribute('stroke', color)
        }
        const rects = element.getElementsByTagName('rect')
        for (let i = 0; i < rects.length; i++) {
            rects[i].setAttribute('fill', color)
            rects[i].setAttribute('stroke', color)
        }
        element.style.fill = color
        element.style.stroke = color
    }

    // === VISIBILITY HELPER (For "NOTE" Mode) ===
    const updateMeasureVisibility = useCallback((currentMeasure: number) => {
        if (revealMode !== 'NOTE' || !measureContentMap.current) return

        measureContentMap.current.forEach((elements, measureNum) => {
            if (measureNum < currentMeasure) {
                // Past: Visible
                elements.forEach(el => el.style.opacity = '1')
            } else if (measureNum > currentMeasure) {
                // Future: Hidden
                elements.forEach(el => el.style.opacity = '0')
            } else {
                // Current Measure: Show beams/rests, let Note loop handle notes
                elements.forEach(el => {
                    if (el.classList.contains('vf-beam') || el.classList.contains('vf-rest')) {
                        el.style.opacity = '1'
                    }
                })
            }
        })
    }, [revealMode])

    // === MODE SWITCHING EFFECT ===
    useEffect(() => {
        // Reset everything to visible if we leave 'NOTE' mode
        if (prevRevealModeRef.current === 'NOTE' && revealMode !== 'NOTE') {
            measureContentMap.current.forEach(elements => elements.forEach(el => el.style.opacity = '1'))
        }

        // If entering 'NOTE' mode, trigger immediate sweep
        if (revealMode === 'NOTE' && audioRef.current) {
            const { measure } = findCurrentMeasure(audioRef.current.currentTime)
            updateMeasureVisibility(measure)
        }

        // If entering 'CURTAIN' mode, Note opacity is reset (curtain handles it)
        if (revealMode === 'CURTAIN') {
            measureContentMap.current.forEach(elements => elements.forEach(el => el.style.opacity = '1'))
        }

        prevRevealModeRef.current = revealMode
    }, [revealMode, updateMeasureVisibility, findCurrentMeasure, audioRef])


    // === ANIMATION LOOP ===
    const updateCursorPosition = useCallback((audioTime: number) => {
        const osmd = osmdRef.current
        if (!osmd || !isLoaded || !cursorRef.current || !osmd.GraphicSheet) return

        const { measure, progress } = findCurrentMeasure(audioTime)
        const effectiveProgress = progress
        const currentMeasureIndex = measure - 1

        try {
            const measureList = osmd.GraphicSheet.MeasureList
            if (!measureList || measureList.length === 0 || currentMeasureIndex >= measureList.length) return
            const measureStaves = measureList[currentMeasureIndex]
            if (!measureStaves || measureStaves.length === 0) return

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const unitInPixels = (osmd.GraphicSheet as any).UnitInPixels || 10

            // 1. Calculate Cursor Geometry
            let minY = Number.MAX_VALUE, maxY = Number.MIN_VALUE
            let minX = Number.MAX_VALUE, maxX = Number.MIN_VALUE
            let minNoteX = Number.MAX_VALUE

            measureStaves.forEach(staffMeasure => {
                const pos = staffMeasure.PositionAndShape
                if (!pos) return
                const absY = pos.AbsolutePosition.y
                const absX = pos.AbsolutePosition.x

                if (absY + pos.BorderTop < minY) minY = absY + pos.BorderTop
                if (absY + pos.BorderBottom > maxY) maxY = absY + pos.BorderBottom
                if (absX + pos.BorderLeft < minX) minX = absX + pos.BorderLeft
                if (absX + pos.BorderRight > maxX) maxX = absX + pos.BorderRight

                if (staffMeasure.staffEntries.length > 0) {
                    const firstEntry = staffMeasure.staffEntries[0]
                    const noteAbsX = absX + firstEntry.PositionAndShape.RelativePosition.x
                    if (noteAbsX < minNoteX) minNoteX = noteAbsX
                }
            })

            const systemTop = minY * unitInPixels
            const systemHeight = (maxY - minY) * unitInPixels
            const paddingPixels = 12
            const paddingUnits = paddingPixels / unitInPixels
            let visualStartX = minX
            if (measure === 1 && minNoteX < Number.MAX_VALUE) {
                visualStartX = Math.max(minX, minNoteX - paddingUnits)
            }

            const systemX = visualStartX * unitInPixels
            const systemWidth = (maxX - visualStartX) * unitInPixels
            const cursorX = systemX + (systemWidth * effectiveProgress)

            // Update Cursor
            cursorRef.current.style.left = `${cursorX}px`
            cursorRef.current.style.top = `${systemTop}px`
            cursorRef.current.style.height = `${systemHeight}px`
            cursorRef.current.style.display = 'block'
            cursorRef.current.style.backgroundColor = mode === 'RECORD' ? 'rgba(239, 68, 68, 0.6)' : 'rgba(16, 185, 129, 0.8)'
            cursorRef.current.style.boxShadow = mode === 'RECORD' ? '0 0 10px rgba(239, 68, 68, 0.4)' : '0 0 8px rgba(16, 185, 129, 0.5)'

            // 2. Scroll Logic
            if (scrollContainerRef.current) {
                const container = scrollContainerRef.current
                const containerWidth = container.clientWidth
                const targetScrollLeft = cursorX - (containerWidth * 0.2)
                const currentScroll = container.scrollLeft
                const diff = Math.abs(currentScroll - targetScrollLeft)
                const isUserControlling = diff > 250

                if (!isUserControlling) container.scrollLeft = targetScrollLeft

                if (currentMeasureIndex !== lastMeasureIndexRef.current && diff > 50) {
                    container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
                }
            }

            // 3. Mode Specific Logic

            // A. CURTAIN MODE: Slide the white box
            if (curtainRef.current) {
                if (revealMode === 'CURTAIN') {
                    curtainRef.current.style.display = 'block'
                    curtainRef.current.style.left = `${cursorX}px`
                    curtainRef.current.style.width = '50000px' // Extend to infinity
                } else {
                    curtainRef.current.style.display = 'none'
                }
            }

            // B. NOTE MODE: Trigger measure visibility check
            if (revealMode === 'NOTE' && currentMeasureIndex !== lastMeasureIndexRef.current) {
                updateMeasureVisibility(measure)
            }

            lastMeasureIndexRef.current = currentMeasureIndex

            // 4. Karaoke & Note Specific Hiding
            const notesInMeasure = noteMap.current.get(measure)

            if (notesInMeasure && mode === 'PLAYBACK') {
                const fullMeasureWidth = maxX - minX
                const activeWidth = maxX - visualStartX
                const startOffset = visualStartX - minX
                const offsetRatio = fullMeasureWidth > 0 ? startOffset / fullMeasureWidth : 0
                const scaleRatio = fullMeasureWidth > 0 ? activeWidth / fullMeasureWidth : 1
                const highlightProgress = offsetRatio + (effectiveProgress * scaleRatio)

                notesInMeasure.forEach(noteData => {
                    if (!noteData.element) return
                    const lookahead = 0.04
                    const noteEndThreshold = noteData.timestamp + 0.01

                    // Reveal Logic (Only for 'NOTE' mode)
                    // For 'CURTAIN' mode, the curtain handles hiding, we just handle color
                    if (revealMode === 'NOTE') {
                        if (highlightProgress < noteData.timestamp - lookahead) {
                            noteData.element.style.opacity = '0'
                        } else {
                            noteData.element.style.opacity = '1'
                        }
                    }

                    // Color Logic (Green when active)
                    if (highlightProgress <= noteEndThreshold && highlightProgress >= noteData.timestamp - lookahead) {
                        applyColor(noteData.element, '#10B981')
                    } else {
                        applyColor(noteData.element, '#000000')
                    }
                })
            }

            // Record Mode Reset
            if (mode === 'RECORD' && notesInMeasure) {
                notesInMeasure.forEach(noteData => {
                    if (noteData.element) {
                        applyColor(noteData.element, '#000000')
                        noteData.element.style.opacity = '1'
                    }
                })
            }

        } catch (err) {
            console.error('Error positioning cursor:', err)
        }
    }, [findCurrentMeasure, isLoaded, mode, revealMode, updateMeasureVisibility])

    // ... (Animation Loop - Standard)
    useEffect(() => {
        if (!isLoaded) return
        const animate = () => {
            const audioTime = audioRef.current?.currentTime ?? 0
            updateCursorPosition(audioTime)
            animationFrameRef.current = requestAnimationFrame(animate)
        }
        animationFrameRef.current = requestAnimationFrame(animate)
        return () => { if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current) }
    }, [isLoaded, updateCursorPosition, audioRef])

    // ... (Click Handler - Standard)
    const handleScoreClick = useCallback((event: React.MouseEvent) => {
        const osmd = osmdRef.current
        if (!osmd || !osmd.GraphicSheet || !containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const clickX = event.clientX - rect.left
        const clickY = event.clientY - rect.top

        const measureList = osmd.GraphicSheet.MeasureList
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unitInPixels = (osmd.GraphicSheet as any).UnitInPixels || 10
        let clickedMeasureIndex = -1

        for (let i = 0; i < measureList.length; i++) {
            const measureStaves = measureList[i]
            if (!measureStaves) continue
            let minY = Number.MAX_VALUE, maxY = Number.MIN_VALUE, minX = Number.MAX_VALUE, maxX = Number.MIN_VALUE
            measureStaves.forEach(staffMeasure => {
                const pos = staffMeasure.PositionAndShape
                if (!pos) return
                const absY = pos.AbsolutePosition.y
                const absX = pos.AbsolutePosition.x
                if (absY + pos.BorderTop < minY) minY = absY + pos.BorderTop
                if (absY + pos.BorderBottom > maxY) maxY = absY + pos.BorderBottom
                if (absX + pos.BorderLeft < minX) minX = absX + pos.BorderLeft
                if (absX + pos.BorderRight > maxX) maxX = absX + pos.BorderRight
            })
            const boxTop = minY * unitInPixels
            const boxBottom = maxY * unitInPixels
            const boxLeft = minX * unitInPixels
            const boxRight = maxX * unitInPixels
            if (clickX >= boxLeft && clickX <= boxRight && clickY >= boxTop && clickY <= boxBottom) {
                clickedMeasureIndex = i
                break
            }
        }

        if (clickedMeasureIndex !== -1) {
            const measureNumber = clickedMeasureIndex + 1
            const sortedAnchors = [...anchors].sort((a, b) => a.measure - b.measure)
            const targetAnchor = sortedAnchors.reverse().find(a => a.measure <= measureNumber)
            if (targetAnchor && audioRef.current) {
                audioRef.current.currentTime = targetAnchor.time
            }
        }
    }, [anchors, audioRef])

    return (
        <div ref={scrollContainerRef} className="relative w-full h-full overflow-x-auto overflow-y-hidden bg-white">
            <div ref={containerRef} onClick={handleScoreClick} className="w-full min-h-[400px] cursor-pointer" />

            {/* The Cursor */}
            <div ref={cursorRef} id="cursor-overlay" className="absolute pointer-events-none transition-all duration-75"
                style={{
                    left: 0, top: 0, width: '3px', height: '100px',
                    backgroundColor: mode === 'RECORD' ? 'rgba(239, 68, 68, 0.6)' : 'rgba(16, 185, 129, 0.8)',
                    boxShadow: mode === 'RECORD' ? '0 0 10px rgba(239, 68, 68, 0.4)' : '0 0 8px rgba(16, 185, 129, 0.5)',
                    zIndex: 1000, display: 'none', transition: 'left 0.05s linear',
                }}
            />

            {/* The Curtain (Simple Overlay for CURTAIN mode) */}
            <div ref={curtainRef} id="reveal-curtain" className="absolute pointer-events-none bg-white"
                style={{
                    display: 'none',
                    zIndex: 999, // Below cursor, above score
                    top: 0,
                    bottom: 0,
                    // Left and Width are set dynamically
                }}
            />
        </div>
    )
}
