import { useEffect, useRef, useCallback, useState } from 'react'
import { OpenSheetMusicDisplay as OSMD } from 'opensheetmusicdisplay'
import type { AppMode } from '../../App'

interface Anchor {
    measure: number
    time: number
}

// Rename Props
interface PageViewProps {
    audioRef: React.RefObject<HTMLAudioElement | null>
    anchors: Anchor[]
    mode: AppMode
    musicXmlUrl?: string
    // Optional: Add visual props if we want parity, but user didn't strictly ask to IMPLEMENT them in PageView yet, just "Upgrade PageView" in "Next Steps". 
    // I'll stick to basic rename first to ensure stability.
    darkMode?: boolean
}

type NoteData = {
    id: string
    measureIndex: number // 1-based to match anchors
    timestamp: number // 0.0 to 1.0 relative to measure
    element: Element | null
}

export function PageView({ audioRef, anchors, mode, musicXmlUrl, darkMode }: PageViewProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const cursorRef = useRef<HTMLDivElement>(null)
    const scrollContainerRef = useRef<HTMLDivElement>(null) // 1. NEW: Add a Ref for the outer scrollable wrapper
    const lastMeasureIndexRef = useRef<number>(0) // Track backward jumps
    const osmdRef = useRef<OSMD | null>(null)
    const [isLoaded, setIsLoaded] = useState(false)
    const animationFrameRef = useRef<number | null>(null)

    // Master Time Grid: Cache note data for fast lookup
    // Key: Measure Index (1-based), Value: Array of notes in that measure
    const noteMap = useRef<Map<number, NoteData[]>>(new Map())

    // Helper to calculate the Master Time Grid
    const calculateNoteMap = useCallback(() => {
        const osmd = osmdRef.current
        if (!osmd || !osmd.GraphicSheet) return

        console.log('[ScoreViewer] Calculating Master Time Grid...')
        const newNoteMap = new Map<number, NoteData[]>()
        const measureList = osmd.GraphicSheet.MeasureList

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unitInPixels = (osmd.GraphicSheet as any).UnitInPixels || 10

        measureList.forEach((measureStaves, measureIndex) => {
            const measureNumber = measureIndex + 1 // 1-based measure number
            const measureNotes: NoteData[] = []

            if (!measureStaves || measureStaves.length === 0) return

            // Iterate through ALL staves (Treble, Bass, Drums, etc.)
            measureStaves.forEach(staffMeasure => {
                if (!staffMeasure) return

                const measurePos = staffMeasure.PositionAndShape
                const measureWidth = (measurePos.BorderRight - measurePos.BorderLeft) * unitInPixels

                // Iterate through all staff entries (notes/chords)
                staffMeasure.staffEntries.forEach(entry => {
                    const graphicalVoiceEntries = entry.graphicalVoiceEntries
                    if (!graphicalVoiceEntries) return

                    // Calculate relative x position in measure (0.0 to 1.0)
                    // Entry RelativePosition is relative to the measure's AbsolutePosition
                    const relX = entry.PositionAndShape.RelativePosition.x * unitInPixels
                    const relativeTimestamp = relX / measureWidth

                    graphicalVoiceEntries.forEach(gve => {
                        if (!gve.notes) return

                        gve.notes.forEach(note => {
                            // Access internal VexFlow note to get ID
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const internalNote = note as any
                            if (internalNote.vfnote && internalNote.vfnote.length > 0) {
                                const vfStaveNote = internalNote.vfnote[0]
                                const vfId = vfStaveNote.attrs ? vfStaveNote.attrs.id : null

                                if (vfId) {
                                    // Try to find the element in DOM
                                    // Check both raw ID and vf- prefixed ID
                                    let element = document.getElementById(vfId)
                                    if (!element) {
                                        element = document.getElementById(`vf-${vfId}`)
                                    }

                                    if (element) {
                                        measureNotes.push({
                                            id: vfId,
                                            measureIndex: measureNumber,
                                            timestamp: relativeTimestamp,
                                            element: element
                                        })
                                    } else {
                                        // Warn only if we expected to find it (sanity check)
                                        // console.warn(`[ScoreViewer] Could not find DOM element for note ${vfId}`)
                                    }
                                }
                            }
                        })
                    })
                })
            })

            if (measureNotes.length > 0) {
                newNoteMap.set(measureNumber, measureNotes)
            }
        })

        noteMap.current = newNoteMap
        console.log(`[ScoreViewer] Built Master Time Grid with ${newNoteMap.size} measures`)
    }, [])

    // Initialize OSMD
    useEffect(() => {
        if (!containerRef.current || osmdRef.current) return

        const osmd = new OSMD(containerRef.current, {
            autoResize: true,
            followCursor: false, // We're using custom cursor
            drawTitle: true,
            drawSubtitle: true,
            drawComposer: true,
            drawCredits: true,
            drawPartNames: true,
            drawMeasureNumbers: true,
        })

        osmdRef.current = osmd

        // Load the MusicXML file
        const xmlUrl = musicXmlUrl || '/c-major-exercise.musicxml'

        osmd.load(xmlUrl).then(() => {
            osmd.render()
            // Force a resize after a short delay to ensure layout is correct
            // This fixes the issue where the score loads with incorrect system breaks (e.g. 2 staves)
            // before snapping to the correct width.
            setTimeout(() => {
                osmd.render()
                calculateNoteMap()
            }, 100)

            calculateNoteMap()
            setIsLoaded(true)
        }).catch((err) => {
            console.error('Failed to load MusicXML:', err)
        })

        return () => {
            osmdRef.current = null
            setIsLoaded(false)
        }
    }, [musicXmlUrl, calculateNoteMap])

    // Handle Resize
    useEffect(() => {
        const handleResize = () => {
            // OSMD handles the render on resize automatically (autoResize: true)
            // But we wait a bit for it to finish then rebuild our map
            // We can't easily hook into OSMD's internal resize event, so we debounce
            setTimeout(() => {
                calculateNoteMap()
            }, 500)
        }

        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [calculateNoteMap])

    // Find the current measure based on audio time
    const findCurrentMeasure = useCallback((time: number): { measure: number; progress: number } => {
        if (anchors.length === 0) {
            return { measure: 1, progress: 0 }
        }

        // Sort anchors by time to ensure correct order
        const sortedAnchors = [...anchors].sort((a, b) => a.time - b.time)

        // Find which measure we're in
        let currentMeasure = 1
        let measureStartTime = 0
        let measureEndTime = Infinity

        for (let i = 0; i < sortedAnchors.length; i++) {
            const anchor = sortedAnchors[i]

            if (time >= anchor.time) {
                currentMeasure = anchor.measure
                measureStartTime = anchor.time

                // Get end time from next anchor or infinity
                if (i + 1 < sortedAnchors.length) {
                    measureEndTime = sortedAnchors[i + 1].time
                } else {
                    measureEndTime = Infinity
                }
            } else {
                break
            }
        }

        // Calculate progress through current measure (0.0 to 1.0)
        let progress = 0
        if (measureEndTime !== Infinity && measureEndTime > measureStartTime) {
            progress = (time - measureStartTime) / (measureEndTime - measureStartTime)
            progress = Math.max(0, Math.min(1, progress))
        }

        return { measure: currentMeasure, progress }
    }, [anchors])

    // Helper to set color on an element and its children
    const applyColor = (element: Element, color: string) => {
        // Paths (noteheads, flags, etc)
        const paths = element.getElementsByTagName('path')
        for (let i = 0; i < paths.length; i++) {
            paths[i].setAttribute('fill', color)
            paths[i].setAttribute('stroke', color)
        }
        // Group itself
        element.setAttribute('fill', color)
        element.setAttribute('stroke', color)
    }

    // Update cursor position and note highlighting - called from requestAnimationFrame
    const updateCursorPosition = useCallback((audioTime: number) => {
        const osmd = osmdRef.current
        if (!osmd || !isLoaded || !cursorRef.current) return
        if (!osmd.GraphicSheet) return

        const { measure, progress } = findCurrentMeasure(audioTime)

        // In RECORD mode: We still want to see where we are (Ghost Cursor), so use real progress!
        // But if we want to visually distinguish "locked" vs "live", we do that in styling.
        const effectiveProgress = progress

        // Convert to 0-index for OSMD
        const currentMeasureIndex = measure - 1

        try {
            // === CURSOR POSITIONING ===
            const measureList = osmd.GraphicSheet.MeasureList

            if (!measureList || measureList.length === 0) return
            if (currentMeasureIndex >= measureList.length) return

            const measureStaves = measureList[currentMeasureIndex]
            if (!measureStaves || measureStaves.length === 0) return

            // --- NEW LOGIC: Calculate bounds across ALL staves in the system ---
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const unitInPixels = (osmd.GraphicSheet as any).UnitInPixels || 10

            let minY = Number.MAX_VALUE
            let maxY = Number.MIN_VALUE
            let minX = Number.MAX_VALUE
            let maxX = Number.MIN_VALUE
            let minNoteX = Number.MAX_VALUE

            // Loop through every instrument/stave in this vertical slice
            measureStaves.forEach(staffMeasure => {
                const pos = staffMeasure.PositionAndShape
                if (!pos) return

                const absoluteY = pos.AbsolutePosition.y
                const absoluteX = pos.AbsolutePosition.x

                // Calculate top and bottom of this specific stave
                const top = absoluteY + pos.BorderTop
                const bottom = absoluteY + pos.BorderBottom

                // Expand our global bounding box
                if (top < minY) minY = top
                if (bottom > maxY) maxY = bottom

                // We also need the X positions
                const left = absoluteX + pos.BorderLeft
                const right = absoluteX + pos.BorderRight

                if (left < minX) minX = left
                if (right > maxX) maxX = right

                // --- NEW LOGIC: Find the X position of the FIRST NOTE ---
                if (staffMeasure.staffEntries.length > 0) {
                    const firstEntry = staffMeasure.staffEntries[0]
                    const noteAbsX = absoluteX + firstEntry.PositionAndShape.RelativePosition.x
                    if (noteAbsX < minNoteX) minNoteX = noteAbsX
                }
            })

            // Convert to pixels
            const systemTop = minY * unitInPixels
            const systemHeight = (maxY - minY) * unitInPixels

            // === THE FIX: Adjust Start Position & Highlighting Coordinates ===

            // 1. Determine where the cursor actually starts visually
            // For Measure 1: Start at First Note (minNoteX) minus a little padding
            // For others: Start at Barline (minX)
            const paddingPixels = 12
            const paddingUnits = paddingPixels / unitInPixels

            let visualStartX = minX

            if (measure === 1 && minNoteX < Number.MAX_VALUE) {
                visualStartX = Math.max(minX, minNoteX - paddingUnits)
            }

            const systemX = visualStartX * unitInPixels
            const systemWidth = (maxX - visualStartX) * unitInPixels

            // Apply interpolation
            const cursorX = systemX + (systemWidth * effectiveProgress)

            // Update Cursor Style
            cursorRef.current.style.left = `${cursorX}px`
            cursorRef.current.style.top = `${systemTop}px`
            cursorRef.current.style.height = `${systemHeight}px`
            cursorRef.current.style.display = 'block'

            // Update cursor color based on mode
            cursorRef.current.style.backgroundColor = mode === 'RECORD'
                ? 'rgba(255, 0, 0, 0.8)'  // Red for RECORD
                : 'rgba(16, 185, 129, 0.8)' // Green (#10B981) for PLAYBACK
            cursorRef.current.style.boxShadow = mode === 'RECORD'
                ? '0 0 8px rgba(255, 0, 0, 0.5)'
                : '0 0 8px rgba(16, 185, 129, 0.5)'


            // 2. NEW: Auto-Scroll Logic ("Page Turn" Style)
            if (scrollContainerRef.current) {
                const container = scrollContainerRef.current
                const containerTop = container.scrollTop
                const containerBottom = container.scrollTop + container.clientHeight
                const cursorBottom = systemTop + systemHeight

                // CRITICAL FIX: Only auto-scroll if the measure actually CHANGED.
                // This stops the app from fighting your manual scrolling 60 times a second.
                if (currentMeasureIndex !== lastMeasureIndexRef.current) {

                    // Case A: Cursor moved forward into a hidden area below (Page Turn)
                    if (cursorBottom > containerBottom) {
                        container.scrollTo({ top: systemTop - 20, behavior: 'smooth' })
                    }
                    // Case B: Cursor moved backward into a hidden area above (Loop/Jump)
                    else if (systemTop < containerTop) {
                        container.scrollTo({ top: systemTop - 20, behavior: 'smooth' })
                    }
                }
            }

            // Update history for next frame
            lastMeasureIndexRef.current = currentMeasureIndex

            // === KARAOKE HIGHLIGHTING (Fixed Coordinate System) ===
            // 1. Get notes for the current measure
            const notesInMeasure = noteMap.current.get(measure)

            if (notesInMeasure && mode === 'PLAYBACK') {
                // We need to map "effectiveProgress" (Cursor System) back to "Measure System"
                // because notes are stored relative to the FULL measure width (minX -> maxX).

                const fullMeasureWidth = maxX - minX
                const activeWidth = maxX - visualStartX
                const startOffset = visualStartX - minX

                // Ratio of the "Dead Zone" (Clef/KeySig) vs Full Width
                const offsetRatio = fullMeasureWidth > 0 ? startOffset / fullMeasureWidth : 0
                // Ratio of the "Playable Area" vs Full Width
                const scaleRatio = fullMeasureWidth > 0 ? activeWidth / fullMeasureWidth : 1

                // Convert Audio Progress -> Measure Progress
                // e.g., Audio 0% -> Measure 20% (exactly where Note 1 is)
                const highlightProgress = offsetRatio + (effectiveProgress * scaleRatio)

                notesInMeasure.forEach(noteData => {
                    if (!noteData.element) return

                    const lookahead = 0.04
                    const noteEndThreshold = noteData.timestamp + 0.01

                    // Use the ADJUSTED progress here
                    if (highlightProgress <= noteEndThreshold && highlightProgress >= noteData.timestamp - lookahead) {
                        applyColor(noteData.element, '#10B981')
                    } else {
                        applyColor(noteData.element, '#000000')
                    }
                })
            }

            // Clean up: Reset notes in RECORD mode
            if (mode === 'RECORD') {
                // Ideally we should traverse everything we highlighted. 
                // Grouping makes this easier: we only need to reset the *current* measure's notes if we just switched?
                // Or just iterate all notes to be safe? 
                // Iterating *all* notes in the song 60fps is bad. 
                // But RECORD mode doesn't need 60fps highlighting. 
                // Usually we just switched mode. 
                // Let's just reset the current measure's notes to black in loop, it's fast enough.
                if (notesInMeasure) {
                    notesInMeasure.forEach(noteData => {
                        if (noteData.element) applyColor(noteData.element, '#000000')
                    })
                }
            }

        } catch (err) {
            console.error('Error positioning cursor:', err)
        }
    }, [findCurrentMeasure, isLoaded, mode])

    // requestAnimationFrame loop for smooth cursor updates
    useEffect(() => {
        if (!isLoaded) return

        const animate = () => {
            const audioTime = audioRef.current?.currentTime ?? 0
            updateCursorPosition(audioTime)
            animationFrameRef.current = requestAnimationFrame(animate)
        }

        // Start the animation loop
        animationFrameRef.current = requestAnimationFrame(animate)

        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current)
            }
        }
    }, [isLoaded, updateCursorPosition, audioRef])

    // CLICK HANDLER: Translate XY click to Measure -> Time -> Seek
    const handleScoreClick = useCallback((event: React.MouseEvent) => {
        const osmd = osmdRef.current
        if (!osmd || !osmd.GraphicSheet || !containerRef.current) return

        // 1. Get click coordinates relative to the internal OSMD container
        const rect = containerRef.current.getBoundingClientRect()
        const clickX = event.clientX - rect.left
        const clickY = event.clientY - rect.top

        // 2. Loop through measures to find the one we clicked
        const measureList = osmd.GraphicSheet.MeasureList
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unitInPixels = (osmd.GraphicSheet as any).UnitInPixels || 10

        let clickedMeasureIndex = -1

        for (let i = 0; i < measureList.length; i++) {
            const measureStaves = measureList[i]
            if (!measureStaves) continue

            // Calculate Bounding Box for this measure (Reuse logic from updateCursorPosition)
            let minY = Number.MAX_VALUE
            let maxY = Number.MIN_VALUE
            let minX = Number.MAX_VALUE
            let maxX = Number.MIN_VALUE

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

            // Convert to Pixels for hit testing
            const boxTop = minY * unitInPixels
            const boxBottom = maxY * unitInPixels
            const boxLeft = minX * unitInPixels
            const boxRight = maxX * unitInPixels

            // Check if click is inside this box
            if (clickX >= boxLeft && clickX <= boxRight && clickY >= boxTop && clickY <= boxBottom) {
                clickedMeasureIndex = i
                break // Found it!
            }
        }

        if (clickedMeasureIndex !== -1) {
            const measureNumber = clickedMeasureIndex + 1
            console.log(`Clicked Measure: ${measureNumber}`)

            // 3. Find the anchor for this measure
            // Strategy: Find exact match, or fallback to the closest PREVIOUS anchor
            // This ensures if you click M12 but only anchored M10, it plays from M10.
            const sortedAnchors = [...anchors].sort((a, b) => a.measure - b.measure)

            // Find the closest anchor that is <= the clicked measure
            const targetAnchor = sortedAnchors.reverse().find(a => a.measure <= measureNumber)

            if (targetAnchor && audioRef.current) {
                audioRef.current.currentTime = targetAnchor.time
                // Optional: If you want it to auto-play on click
                // if (audioRef.current.paused) audioRef.current.play()
            }
        }
    }, [anchors, audioRef]) // eslint-disable-line

    return (
        <div
            ref={scrollContainerRef}
            className="relative w-full h-full overflow-auto bg-white"
        >
            {/* OSMD Container - NOW CLICKABLE */}
            <div
                ref={containerRef}
                onClick={handleScoreClick} // <--- Attach handler here
                className="w-full min-h-[400px] cursor-pointer" // <--- Add pointer cursor
            />

            {/* Custom Cursor Overlay */}
            <div
                ref={cursorRef}
                id="cursor-overlay"
                className="absolute pointer-events-none transition-all duration-75" // Added transition for smooth color swap
                style={{
                    left: 0,
                    top: 0,
                    width: '3px',
                    height: '100px',
                    // Logic: Record = Red (Live Recording), Playback = Green (Synced)
                    backgroundColor: mode === 'RECORD'
                        ? 'rgba(239, 68, 68, 0.6)' // Red-500 with opacity (Ghost-like)
                        : 'rgba(16, 185, 129, 0.8)', // Emerald-500

                    // Logic: Record = Glow red, Playback = Glow green
                    boxShadow: mode === 'RECORD'
                        ? '0 0 10px rgba(239, 68, 68, 0.4)'
                        : '0 0 8px rgba(16, 185, 129, 0.5)',

                    zIndex: 1000,
                    display: 'none',
                    // Ensure smooth movement in both modes now!
                    transition: 'left 0.05s linear',
                }}
            />
        </div>
    )
}
