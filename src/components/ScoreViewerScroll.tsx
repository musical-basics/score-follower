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

export function ScoreViewerScroll({ audioRef, anchors, mode, musicXmlUrl }: ScoreViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const cursorRef = useRef<HTMLDivElement>(null)
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const lastMeasureIndexRef = useRef<number>(0)
    const osmdRef = useRef<OSMD | null>(null)
    const [isLoaded, setIsLoaded] = useState(false)
    const animationFrameRef = useRef<number | null>(null)

    // Master Time Grid: Cache note data for fast lookup
    const noteMap = useRef<Map<number, NoteData[]>>(new Map())

    // Helper to calculate the Master Time Grid
    const calculateNoteMap = useCallback(() => {
        const osmd = osmdRef.current
        if (!osmd || !osmd.GraphicSheet) return

        console.log('[ScoreViewerScroll] Calculating Master Time Grid...')
        const newNoteMap = new Map<number, NoteData[]>()
        const measureList = osmd.GraphicSheet.MeasureList

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unitInPixels = (osmd.GraphicSheet as any).UnitInPixels || 10

        measureList.forEach((measureStaves, measureIndex) => {
            const measureNumber = measureIndex + 1
            const measureNotes: NoteData[] = []

            if (!measureStaves || measureStaves.length === 0) return

            measureStaves.forEach(staffMeasure => {
                if (!staffMeasure) return

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
        console.log(`[ScoreViewerScroll] Built Master Time Grid with ${newNoteMap.size} measures`)
    }, [])

    // Initialize OSMD (HORIZONTAL MODE)
    useEffect(() => {
        if (!containerRef.current || osmdRef.current) return

        const osmd = new OSMD(containerRef.current, {
            autoResize: true,
            followCursor: false,
            drawTitle: true,
            drawSubtitle: false, // Save vertical space
            drawComposer: false, // Save vertical space
            drawCredits: false,  // Save vertical space
            drawPartNames: true,
            drawMeasureNumbers: true,
            renderSingleHorizontalStaffline: true // <--- THE MAGIC KEY: Infinite Horizontal Scroll
        })

        osmdRef.current = osmd

        const xmlUrl = musicXmlUrl || '/c-major-exercise.musicxml'

        osmd.load(xmlUrl).then(() => {
            osmd.render()
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
            setTimeout(() => {
                calculateNoteMap()
            }, 500)
        }

        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [calculateNoteMap])

    const findCurrentMeasure = useCallback((time: number): { measure: number; progress: number } => {
        if (anchors.length === 0) {
            return { measure: 1, progress: 0 }
        }

        const sortedAnchors = [...anchors].sort((a, b) => a.time - b.time)

        let currentMeasure = 1
        let measureStartTime = 0
        let measureEndTime = Infinity

        for (let i = 0; i < sortedAnchors.length; i++) {
            const anchor = sortedAnchors[i]

            if (time >= anchor.time) {
                currentMeasure = anchor.measure
                measureStartTime = anchor.time

                if (i + 1 < sortedAnchors.length) {
                    measureEndTime = sortedAnchors[i + 1].time
                } else {
                    measureEndTime = Infinity
                }
            } else {
                break
            }
        }

        let progress = 0
        if (measureEndTime !== Infinity && measureEndTime > measureStartTime) {
            progress = (time - measureStartTime) / (measureEndTime - measureStartTime)
            progress = Math.max(0, Math.min(1, progress))
        }

        return { measure: currentMeasure, progress }
    }, [anchors])

    const applyColor = (element: Element, color: string) => {
        const paths = element.getElementsByTagName('path')
        for (let i = 0; i < paths.length; i++) {
            paths[i].setAttribute('fill', color)
            paths[i].setAttribute('stroke', color)
        }
        element.setAttribute('fill', color)
        element.setAttribute('stroke', color)
    }

    const updateCursorPosition = useCallback((audioTime: number) => {
        const osmd = osmdRef.current
        if (!osmd || !isLoaded || !cursorRef.current) return
        if (!osmd.GraphicSheet) return

        const { measure, progress } = findCurrentMeasure(audioTime)
        const effectiveProgress = progress
        const currentMeasureIndex = measure - 1

        try {
            const measureList = osmd.GraphicSheet.MeasureList

            if (!measureList || measureList.length === 0) return
            if (currentMeasureIndex >= measureList.length) return

            const measureStaves = measureList[currentMeasureIndex]
            if (!measureStaves || measureStaves.length === 0) return

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const unitInPixels = (osmd.GraphicSheet as any).UnitInPixels || 10

            let minY = Number.MAX_VALUE
            let maxY = Number.MIN_VALUE
            let minX = Number.MAX_VALUE
            let maxX = Number.MIN_VALUE

            measureStaves.forEach(staffMeasure => {
                const pos = staffMeasure.PositionAndShape
                if (!pos) return

                const absoluteY = pos.AbsolutePosition.y
                const absoluteX = pos.AbsolutePosition.x

                const top = absoluteY + pos.BorderTop
                const bottom = absoluteY + pos.BorderBottom

                if (top < minY) minY = top
                if (bottom > maxY) maxY = bottom

                const left = absoluteX + pos.BorderLeft
                const right = absoluteX + pos.BorderRight

                if (left < minX) minX = left
                if (right > maxX) maxX = right
            })

            const systemTop = minY * unitInPixels
            const systemHeight = (maxY - minY) * unitInPixels
            const systemX = minX * unitInPixels
            const systemWidth = (maxX - minX) * unitInPixels

            const cursorX = systemX + (systemWidth * effectiveProgress)

            cursorRef.current.style.left = `${cursorX}px`
            cursorRef.current.style.top = `${systemTop}px`
            cursorRef.current.style.height = `${systemHeight}px`
            cursorRef.current.style.display = 'block'

            cursorRef.current.style.backgroundColor = mode === 'RECORD'
                ? 'rgba(239, 68, 68, 0.6)'
                : 'rgba(16, 185, 129, 0.8)'
            cursorRef.current.style.boxShadow = mode === 'RECORD'
                ? '0 0 10px rgba(239, 68, 68, 0.4)'
                : '0 0 8px rgba(16, 185, 129, 0.5)'

            // === HORIZONTAL SCROLL LOGIC ===
            if (scrollContainerRef.current) {
                const container = scrollContainerRef.current
                const containerWidth = container.clientWidth
                const currentScroll = container.scrollLeft
                const cursorScreenX = cursorX - currentScroll

                // 1. Measure Change Check (The "Page Turn")
                // We ONLY scroll when the measure actually changes.
                // This prevents the "fighting" sensation while scrolling within a measure.
                if (currentMeasureIndex !== lastMeasureIndexRef.current) {

                    // 2. "Smart Snap": Only snap if the cursor is actually visible or close.
                    // If you scrolled WAY back to Measure 1 (while music is at M50), 
                    // we assume you want to stay there, so we DON'T snap.
                    // "Close" = within 2 screen widths.
                    const isReadingHistory = cursorScreenX > (containerWidth * 2)

                    if (!isReadingHistory) {
                        // Snap the cursor to the 20% mark (left-ish side of screen)
                        // so you have plenty of space to read ahead.
                        container.scrollTo({
                            left: cursorX - (containerWidth * 0.2),
                            behavior: 'smooth'
                        })
                    }
                }
            }

            lastMeasureIndexRef.current = currentMeasureIndex

            // === KARAOKE HIGHLIGHTING ===
            const notesInMeasure = noteMap.current.get(measure)

            if (notesInMeasure && mode === 'PLAYBACK') {
                notesInMeasure.forEach(noteData => {
                    if (!noteData.element) return
                    const lookahead = 0.04
                    const noteEndThreshold = noteData.timestamp + 0.01

                    if (effectiveProgress <= noteEndThreshold && effectiveProgress >= noteData.timestamp - lookahead) {
                        applyColor(noteData.element, '#10B981')
                    } else {
                        applyColor(noteData.element, '#000000')
                    }
                })
            }

            if (mode === 'RECORD') {
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

    useEffect(() => {
        if (!isLoaded) return

        const animate = () => {
            const audioTime = audioRef.current?.currentTime ?? 0
            updateCursorPosition(audioTime)
            animationFrameRef.current = requestAnimationFrame(animate)
        }

        animationFrameRef.current = requestAnimationFrame(animate)

        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current)
            }
        }
    }, [isLoaded, updateCursorPosition, audioRef])

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
            console.log(`Clicked Measure: ${measureNumber}`)

            const sortedAnchors = [...anchors].sort((a, b) => a.measure - b.measure)
            const targetAnchor = sortedAnchors.reverse().find(a => a.measure <= measureNumber)

            if (targetAnchor && audioRef.current) {
                audioRef.current.currentTime = targetAnchor.time
            }
        }
    }, [anchors, audioRef])

    return (
        <div
            ref={scrollContainerRef}
            className="relative w-full h-full overflow-x-auto overflow-y-hidden bg-white" // Horizontal Scroll Only
        >
            <div
                ref={containerRef}
                onClick={handleScoreClick}
                className="w-full min-h-[400px] cursor-pointer"
            />

            <div
                ref={cursorRef}
                id="cursor-overlay"
                className="absolute pointer-events-none transition-all duration-75"
                style={{
                    left: 0,
                    top: 0,
                    width: '3px',
                    height: '100px',
                    backgroundColor: mode === 'RECORD'
                        ? 'rgba(239, 68, 68, 0.6)'
                        : 'rgba(16, 185, 129, 0.8)',
                    boxShadow: mode === 'RECORD'
                        ? '0 0 10px rgba(239, 68, 68, 0.4)'
                        : '0 0 8px rgba(16, 185, 129, 0.5)',
                    zIndex: 1000,
                    display: 'none',
                    transition: 'left 0.05s linear',
                }}
            />
        </div>
    )
}
