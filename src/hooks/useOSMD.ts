import { useState, useEffect, useRef } from 'react'
import { OpenSheetMusicDisplay as OSMD } from 'opensheetmusicdisplay'

export function useOSMD(containerRef: React.RefObject<HTMLDivElement>, musicXmlUrl: string | undefined, options: any) {
    const osmdRef = useRef<OSMD | null>(null)
    const [isLoaded, setIsLoaded] = useState(false)

    useEffect(() => {
        if (!containerRef.current) return

        // 1. Initialize
        const osmd = new OSMD(containerRef.current, options)
        osmdRef.current = osmd

        // 2. Load & Render
        const fileUrl = musicXmlUrl || '/c-major-exercise.musicxml'
        osmd.load(fileUrl).then(() => {
            osmd.render()
            setIsLoaded(true)
        }).catch(err => console.error("OSMD Error:", err))

        return () => { osmdRef.current = null; setIsLoaded(false) }
    }, [musicXmlUrl]) // Re-run if URL changes

    return { osmdRef, isLoaded }
}
