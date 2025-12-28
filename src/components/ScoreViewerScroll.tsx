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
    revealMode: 'OFF' | 'NOTE' | 'CURTAIN'
    popEffect: boolean
    darkMode: boolean
    highlightNote: boolean
    glowEffect: boolean         // <--- NEW PROP
    jumpEffect: boolean         // <--- NEW PROP
    cursorPosition: number
    isLocked: boolean
}

type NoteData = {
    id: string
    measureIndex: number
    timestamp: number
    element: HTMLElement | null
    stemElement: HTMLElement | null
}

export function ScoreViewerScroll({ audioRef, anchors, mode, musicXmlUrl, revealMode, popEffect, jumpEffect, glowEffect, darkMode, highlightNote, cursorPosition, isLocked }: ScoreViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const cursorRef = useRef<HTMLDivElement>(null)
    const curtainRef = useRef<HTMLDivElement>(null)
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    const lastMeasureIndexRef = useRef<number>(-1)
    const prevRevealModeRef = useRef<'OFF' | 'NOTE' | 'CURTAIN'>('OFF')

    const osmdRef = useRef<OSMD | null>(null)
    const [isLoaded, setIsLoaded] = useState(false)
    const animationFrameRef = useRef<number | null>(null)

    const noteMap = useRef<Map<number, NoteData[]>>(new Map())
    const measureContentMap = useRef<Map<number, HTMLElement[]>>(new Map())
    const staffLinesRef = useRef<HTMLElement[]>([])
    const allSymbolsRef = useRef<HTMLElement[]>([]) // <--- NEW: Track ALL symbols for coloring

    // === 1. BUILD MAPS ===
    const calculateNoteMap = useCallback(() => {
        const osmd = osmdRef.current
        if (!osmd || !osmd.GraphicSheet || !containerRef.current) return

        console.time('[ScoreViewerScroll] Spatial Map Build') // Performance Tracking
        const newNoteMap = new Map<number, NoteData[]>()
        const newMeasureContentMap = new Map<number, HTMLElement[]>()
        const newAllSymbols: HTMLElement[] = [] // <--- For Dark Mode Coloring (Everything)
        const newStaffLines: HTMLElement[] = [] // <--- For Staff Line Coloring

        const measureList = osmd.GraphicSheet.MeasureList
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unitInPixels = (osmd.GraphicSheet as any).UnitInPixels || 10

        // A. Calculate Measure Boundaries
        // We assume measures are sorted by index, and generally by X position for a scrolling view.
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
                // Add padding for hit testing
                measureBounds.push({
                    index: measureNumber,
                    left: (minX * unitInPixels) - 5,
                    right: (maxX * unitInPixels) + 5
                })
            }
        })

        // B. Note Map (Timing/Coloring)
        // ... (Existing logic for NoteMap is efficient enough as it iterates logical notes, not DOM)
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
                                        const group = element.closest('.vf-stavenote') as HTMLElement || element as HTMLElement
                                        const childPaths = group.querySelectorAll('path')
                                        childPaths.forEach(p => {
                                            const pathEl = p as unknown as HTMLElement
                                            pathEl.style.transformBox = 'fill-box'
                                            pathEl.style.transformOrigin = 'center'
                                            pathEl.style.transition = 'transform 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275), fill 0.1s, stroke 0.1s'
                                        })
                                        measureNotes.push({
                                            id: vfId, measureIndex: measureNumber, timestamp: relativeTimestamp,
                                            element: group, stemElement: null
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

        // C. Stem Scanner (DOM Based - keeping as it targets finite stems)
        const allStems = Array.from(containerRef.current.querySelectorAll('.vf-stem'))
        allStems.forEach(stem => {
            const stemRect = stem.getBoundingClientRect()
            const stemX = stemRect.left + (stemRect.width / 2)
            let closestNote: NoteData | null = null
            let minDist = 15
            // Optimization: Only search notes in visible range or optimize this lookup?
            // For now, linear walk of newNoteMap is acceptable as map size is managed.
            newNoteMap.forEach(notes => {
                notes.forEach(note => {
                    if (note.element) {
                        const noteRect = note.element.getBoundingClientRect()
                        const noteX = noteRect.left + (noteRect.width / 2)
                        const dist = Math.abs(stemX - noteX)
                        if (dist < minDist) {
                            minDist = dist
                            closestNote = note
                        }
                    }
                })
            })
            if (closestNote) (closestNote as NoteData).stemElement = stem as HTMLElement
        })

        // D. UNIVERSAL CONTENT MAP (Visibility & Coloring) - CRITICAL OPTIMIZATION
        const selector = 'svg path, svg rect, svg text'
        const allElements = containerRef.current.querySelectorAll(selector) // NodeList (faster than Array.from)
        const containerRect = containerRef.current.getBoundingClientRect()
        const containerLeft = containerRect.left

        // Helper: Binary Search for Measure Index
        const findMeasureForX = (x: number) => {
            let low = 0
            let high = measureBounds.length - 1
            while (low <= high) {
                const mid = Math.floor((low + high) / 2)
                const bound = measureBounds[mid]
                if (x >= bound.left && x <= bound.right) {
                    return bound
                } else if (x < bound.left) {
                    high = mid - 1
                } else {
                    low = mid + 1
                }
            }
            return null
        }

        // Loop optimization: for loop is faster than forEach
        for (let i = 0; i < allElements.length; i++) {
            const element = allElements[i] as HTMLElement

            // Skip hidden elements check if possible, or assume all rendered elements are visible
            // removing getComputedStyle check improves perf massively.
            // SVG elements usually don't have display:none unless we put it there.

            const rect = element.getBoundingClientRect()

            // Basic classification based on classes (VexFlow adds classes)
            // .vf-stavenote, .vf-beam, .vf-rest, .vf-clef...
            // Note: classList.contains is fast.
            const cl = element.classList
            // Check if it's a known VexFlow musical element or child of one
            const isMusical = cl.contains('vf-stavenote') || cl.contains('vf-beam') ||
                cl.contains('vf-rest') || cl.contains('vf-clef') ||
                cl.contains('vf-keysignature') || cl.contains('vf-timesignature') ||
                cl.contains('vf-stem') || cl.contains('vf-modifier') ||
                element.closest('.vf-stavenote, .vf-beam, .vf-rest, .vf-clef, .vf-keysignature, .vf-timesignature, .vf-stem, .vf-modifier') !== null

            // Detect Staff Lines (Geometry heuristic)
            if (!isMusical) {
                // Staff lines are typically wide and thin
                const isWide = rect.width > 50
                const isThin = rect.height < 3
                if (isWide && isThin) {
                    newStaffLines.push(element)
                    continue // Done with this element
                }
            }

            // It's a Symbol (Note, Ledger Line, Clef, Text, etc.)
            newAllSymbols.push(element)

            // Bucket into measure using Binary Search instead of Linear Find
            const elCenterX = (rect.left - containerLeft) + (rect.width / 2)

            // Optimization: Most elements are in the "current" or "next" measure relative to previous loop
            // But simple binary search is O(log M), very fast.
            const match = findMeasureForX(elCenterX)

            if (match) {
                let mList = newMeasureContentMap.get(match.index)
                if (!mList) {
                    mList = []
                    newMeasureContentMap.set(match.index, mList)
                }
                mList.push(element)
            }
        }

        noteMap.current = newNoteMap
        measureContentMap.current = newMeasureContentMap
        staffLinesRef.current = newStaffLines
        allSymbolsRef.current = newAllSymbols
        console.timeEnd('[ScoreViewerScroll] Spatial Map Build')

    }, [])

    // ... (Init Effect)
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

    // ... (Resize Effect)
    useEffect(() => {
        const handleResize = () => setTimeout(() => calculateNoteMap(), 500)
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [calculateNoteMap])

    // ... (Find Measure Helper)
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
        if (!element) return

        // 1. Target Children (Paths)
        const paths = element.getElementsByTagName('path')
        for (let i = 0; i < paths.length; i++) {
            const p = paths[i] as unknown as HTMLElement // Force cast for style access
            p.style.fill = color
            p.style.stroke = color
            p.setAttribute('fill', color)
            p.setAttribute('stroke', color)
        }

        // 2. Target Children (Rects - for stems/bars)
        const rects = element.getElementsByTagName('rect')
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i] as unknown as HTMLElement
            r.style.fill = color
            r.style.stroke = color
            r.setAttribute('fill', color)
            r.setAttribute('stroke', color)
        }

        // 3. Target the Element Itself (if it's a path/rect)
        element.style.fill = color
        element.style.stroke = color
    }

    // === VISIBILITY HELPER (Global Sweep) ===
    const updateMeasureVisibility = useCallback((currentMeasure: number) => {
        if (revealMode !== 'NOTE' || !measureContentMap.current) return

        measureContentMap.current.forEach((elements, measureNum) => {
            if (measureNum < currentMeasure) {
                // Past: Visible
                elements.forEach(el => el.style.opacity = '1')
            } else if (measureNum > currentMeasure) {
                // Future: Hidden
                elements.forEach(el => el.style.opacity = '0')
            }
            // Current Measure: Handled per-frame in animation loop
        })
    }, [revealMode])

    // === MODE SWITCHING EFFECT ===
    useEffect(() => {
        if (prevRevealModeRef.current === 'NOTE' && revealMode !== 'NOTE') {
            measureContentMap.current.forEach(elements => elements.forEach(el => el.style.opacity = '1'))
        }
        if (revealMode === 'NOTE' && audioRef.current) {
            const { measure } = findCurrentMeasure(audioRef.current.currentTime)
            updateMeasureVisibility(measure)
        }
        if (revealMode === 'CURTAIN') {
            measureContentMap.current.forEach(elements => elements.forEach(el => el.style.opacity = '1'))
        }
        prevRevealModeRef.current = revealMode
    }, [revealMode, updateMeasureVisibility, findCurrentMeasure, audioRef])

    // === DARK MODE EFFECT ===
    useEffect(() => {
        const baseColor = darkMode ? '#e0e0e0' : '#000000'
        const bgColor = darkMode ? '#222222' : '#ffffff'

        // 1. Color All Music Symbols (Robust Method)
        // Use allSymbolsRef to guarantee we catch every beam/stem, even if bucketing failed
        if (allSymbolsRef.current) {
            allSymbolsRef.current.forEach(el => applyColor(el, baseColor))
        }

        // 2. Color Staff Lines
        if (staffLinesRef.current) {
            staffLinesRef.current.forEach(el => applyColor(el, baseColor))
        }

        // 3. Color Container Background
        if (scrollContainerRef.current) {
            scrollContainerRef.current.style.backgroundColor = bgColor
        }

        // 4. Update Curtain Color (if active)
        if (curtainRef.current) {
            curtainRef.current.style.backgroundColor = bgColor
        }
    }, [darkMode, isLoaded])


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

            // 1. Calculate Cursor Geometry (STABILIZED)
            let firstStaffY = Number.MAX_VALUE
            let lastStaffY = Number.MIN_VALUE
            let minX = Number.MAX_VALUE
            let maxX = Number.MIN_VALUE
            let minNoteX = Number.MAX_VALUE

            measureStaves.forEach(staffMeasure => {
                const pos = staffMeasure.PositionAndShape
                if (!pos) return

                // Y-Axis: Track the STAFF LINES only (Stable)
                const absY = pos.AbsolutePosition.y
                if (absY < firstStaffY) firstStaffY = absY
                if (absY > lastStaffY) lastStaffY = absY

                // X-Axis: Track the Bounding Box (Variable width is okay)
                const absX = pos.AbsolutePosition.x
                if (absX + pos.BorderLeft < minX) minX = absX + pos.BorderLeft
                if (absX + pos.BorderRight > maxX) maxX = absX + pos.BorderRight

                // Note tracking for start offset
                if (staffMeasure.staffEntries.length > 0) {
                    const firstEntry = staffMeasure.staffEntries[0]
                    const noteAbsX = absX + firstEntry.PositionAndShape.RelativePosition.x
                    if (noteAbsX < minNoteX) minNoteX = noteAbsX
                }
            })

            // Calculate Fixed System Height (Stable)
            // 4 units is roughly the height of a 5-line staff. We add padding around it.
            const topPadding = 4
            const bottomPadding = 8

            const systemTop = (firstStaffY - topPadding) * unitInPixels
            const systemHeight = ((lastStaffY - firstStaffY) + bottomPadding + topPadding) * unitInPixels

            // Calculate Cursor X (Dynamic)
            const paddingPixels = 12
            const paddingUnits = paddingPixels / unitInPixels
            let visualStartX = minX
            if (measure === 1 && minNoteX < Number.MAX_VALUE) {
                visualStartX = Math.max(minX, minNoteX - paddingUnits)
            }
            const systemX = visualStartX * unitInPixels
            const systemWidth = (maxX - visualStartX) * unitInPixels
            const cursorX = systemX + (systemWidth * effectiveProgress)

            // Update Cursor DOM
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

                // DYNAMIC TARGET: Use user defined percentage
                const targetScrollLeft = cursorX - (containerWidth * cursorPosition)

                // A. LOCKED MODE (Continuous Scroll)
                if (isLocked) {
                    const currentScroll = container.scrollLeft
                    const diff = Math.abs(currentScroll - targetScrollLeft)
                    const isUserControlling = diff > 250

                    if (!isUserControlling) container.scrollLeft = targetScrollLeft

                    if (currentMeasureIndex !== lastMeasureIndexRef.current && diff > 50) {
                        container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
                    }
                }
                // B. FREE MODE (Measure Scroll)
                else {
                    // Only scroll when we enter a NEW measure
                    if (currentMeasureIndex !== lastMeasureIndexRef.current) {
                        // Snap the new measure to the anchor point
                        container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
                    }
                }
            }

            // 3. Mode Specific Logic

            // A. CURTAIN MODE
            if (curtainRef.current) {
                if (revealMode === 'CURTAIN') {
                    curtainRef.current.style.display = 'block'
                    curtainRef.current.style.backgroundColor = darkMode ? '#222222' : '#ffffff'

                    const curtainLookahead = 180
                    curtainRef.current.style.left = `${cursorX + curtainLookahead}px`
                    curtainRef.current.style.width = '50000px'
                } else {
                    curtainRef.current.style.display = 'none'
                }
            }

            // B. NOTE MODE
            if (revealMode === 'NOTE') {
                if (currentMeasureIndex !== lastMeasureIndexRef.current) {
                    updateMeasureVisibility(measure)
                }

                // Spatial Reveal Logic
                const currentElements = measureContentMap.current.get(measure)
                if (currentElements) {
                    const containerRect = containerRef.current.getBoundingClientRect()
                    currentElements.forEach(el => {
                        const rect = el.getBoundingClientRect()
                        const elLeft = rect.left - containerRect.left

                        // Lookahead: Show items 15px before cursor hits them
                        if (elLeft > cursorX + 15) {
                            el.style.opacity = '0'
                        } else {
                            el.style.opacity = '1'
                        }
                    })
                }
            }

            lastMeasureIndexRef.current = currentMeasureIndex

            // 4. Karaoke (Coloring & FX)
            const notesInMeasure = noteMap.current.get(measure)

            if (notesInMeasure && mode === 'PLAYBACK') {
                const fullMeasureWidth = maxX - minX
                const activeWidth = maxX - visualStartX
                const startOffset = visualStartX - minX
                const offsetRatio = fullMeasureWidth > 0 ? startOffset / fullMeasureWidth : 0
                const scaleRatio = fullMeasureWidth > 0 ? activeWidth / fullMeasureWidth : 1
                const highlightProgress = offsetRatio + (effectiveProgress * scaleRatio)

                // 1. Define Palettes
                const defaultColor = darkMode ? '#e0e0e0' : '#000000'
                const highlightColor = '#10B981' // Green
                const shadowColor = '#10B981'    // Green Glow

                notesInMeasure.forEach(noteData => {
                    if (!noteData.element) return

                    const lookahead = 0.04
                    const noteEndThreshold = noteData.timestamp + 0.01
                    const isActive = (highlightProgress <= noteEndThreshold && highlightProgress >= noteData.timestamp - lookahead)

                    // 2. Determine Target Styles
                    let targetFill = defaultColor
                    let targetFilter = 'none'
                    let targetTransform = 'scale(1) translateY(0)'

                    if (isActive) {
                        // Color
                        if (highlightNote) targetFill = highlightColor

                        // Glow (Filter)
                        if (glowEffect) targetFilter = `drop-shadow(0 0 6px ${shadowColor})`

                        // Pop & Jump (Transform)
                        const scale = popEffect ? 1.4 : 1
                        const jump = jumpEffect ? -10 : 0
                        targetTransform = `scale(${scale}) translateY(${jump}px)`
                    }

                    // 3. Apply Styles (Explicitly Set Everything)

                    // A. Apply Color (Fill/Stroke)
                    applyColor(noteData.element, targetFill)
                    if (noteData.stemElement) applyColor(noteData.stemElement, targetFill)

                    // B. Apply Filter (Glow) - Only to Parent Group to avoid Double Shadow
                    // Note: VexFlow StaveNotes are Groups. Stems are often children. 
                    // Applying filter to Group handles everything.
                    noteData.element.style.filter = targetFilter

                    // Safety: If stem is detached (not a child), apply filter to it too. 
                    // If it IS a child, the parent filter already covers it.
                    if (noteData.stemElement && !noteData.element.contains(noteData.stemElement)) {
                        noteData.stemElement.style.filter = targetFilter
                    }

                    // C. Apply Transform (Pop/Jump) - To Child Paths Only
                    const paths = noteData.element.querySelectorAll('path')
                    paths.forEach(p => (p as unknown as HTMLElement).style.transform = targetTransform)
                })
            }

            // Record Mode Reset
            if (mode === 'RECORD' && notesInMeasure) {
                const defaultColor = darkMode ? '#e0e0e0' : '#000000'
                notesInMeasure.forEach(noteData => {
                    if (noteData.element) {
                        applyColor(noteData.element, defaultColor)
                        if (popEffect) noteData.element.style.filter = 'none'
                    }
                })
            }

        } catch (err) {
            console.error('Error positioning cursor:', err)
        }
    }, [findCurrentMeasure, isLoaded, mode, revealMode, updateMeasureVisibility, popEffect, jumpEffect, glowEffect, darkMode, highlightNote, cursorPosition, isLocked])

    // ... (Animation Loop)
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

    // ... (Click Handler)
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
                }}
            />
        </div>
    )
}
