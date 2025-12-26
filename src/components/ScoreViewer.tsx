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
}

type NoteData = {
    id: string
    measureIndex: number // 1-based to match anchors
    timestamp: number // 0.0 to 1.0 relative to measure
    element: Element | null
}

export function ScoreViewer({ audioRef, anchors, mode, musicXmlUrl }: ScoreViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const cursorRef = useRef<HTMLDivElement>(null)
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

        // In RECORD mode: snap to measure start (progress = 0)
        // In PLAYBACK mode: use interpolated progress
        const effectiveProgress = mode === 'RECORD' ? 0 : progress

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

                // We also need the X positions (they should be roughly aligned, but good to be safe)
                const left = absoluteX + pos.BorderLeft
                const right = absoluteX + pos.BorderRight

                if (left < minX) minX = left
                if (right > maxX) maxX = right
            })

            // Convert to pixels
            const systemTop = minY * unitInPixels
            const systemHeight = (maxY - minY) * unitInPixels
            const systemX = minX * unitInPixels
            const systemWidth = (maxX - minX) * unitInPixels

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


            // === KARAOKE HIGHLIGHTING (Master Time Grid) ===
            // 1. Get notes for the current measure
            const notesInMeasure = noteMap.current.get(measure)

            if (notesInMeasure && mode === 'PLAYBACK') {
                notesInMeasure.forEach(noteData => {
                    if (!noteData.element) return

                    const lookahead = 0.15 // 15% of measure width

                    // Highlight if we are approaching the note or currently on it
                    // But reset if we have passed it (progress > noteData.timestamp)
                    // Wait, previous logic was: "increase noteWidthBuffer... keeps it green until cursor clears it"
                    // "clearing it" means progress > timestamp.

                    // Refined Logic based on "Approaching -> On It -> Passed":
                    // Start highlighting when within 'lookahead' distance
                    // Stop highlighting when 'passed' by some small amount (to account for note width)
                    // Note width is small, maybe 0.02 of measure?

                    const noteEndThreshold = noteData.timestamp + 0.03

                    if (effectiveProgress <= noteEndThreshold && effectiveProgress >= noteData.timestamp - lookahead) {
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

    return (
        <div className="relative w-full h-full overflow-auto bg-white">
            {/* OSMD Container */}
            <div
                ref={containerRef}
                className="w-full min-h-[400px]"
            />

            {/* Custom Cursor Overlay */}
            <div
                ref={cursorRef}
                id="cursor-overlay"
                className="absolute pointer-events-none"
                style={{
                    left: 0,
                    top: 0,
                    width: '3px',
                    height: '100px',
                    backgroundColor: mode === 'RECORD' ? 'rgba(255, 0, 0, 0.8)' : 'rgba(16, 185, 129, 0.8)',
                    boxShadow: mode === 'RECORD' ? '0 0 8px rgba(255, 0, 0, 0.5)' : '0 0 8px rgba(16, 185, 129, 0.5)',
                    zIndex: 1000,
                    display: 'none',
                    transition: mode === 'PLAYBACK' ? 'left 0.05s linear' : 'none',
                }}
            />
        </div>
    )
}
