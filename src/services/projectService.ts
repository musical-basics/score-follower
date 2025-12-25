import { createClient } from '@supabase/supabase-js'

// Initialize client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY

if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase URL or Key missing. Save/Load features will not work.')
}

// Prevent crash by providing placeholder values if missing
export const supabase = createClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseKey || 'placeholder-key'
)

// Function to clean filename for storage
const cleanFileName = (fileName: string) => {
    return fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
}

export interface Project {
    id: string
    title: string
    audio_url: string
    xml_url: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anchors: any[]
    created_at: string
}

export const projectService = {
    // Upload a file to 'scores' bucket and return public URL
    async uploadFile(file: File): Promise<string> {
        const timestamp = Date.now()
        const cleanName = cleanFileName(file.name)
        const fileName = `${timestamp}_${cleanName}`

        const { error: uploadError } = await supabase.storage
            .from('scores')
            .upload(fileName, file)

        if (uploadError) throw uploadError

        // Get public URL
        const { data } = supabase.storage
            .from('scores')
            .getPublicUrl(fileName)

        return data.publicUrl
    },

    // Save project metadata to DB
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async saveProject(title: string, audioFile: File, xmlFile: File, anchors: any[]) {
        // 1. Upload files
        console.log('[ProjectService] Uploading audio...')
        const audioUrl = await this.uploadFile(audioFile)

        console.log('[ProjectService] Uploading XML...')
        const xmlUrl = await this.uploadFile(xmlFile)

        // 2. Insert row
        console.log('[ProjectService] Saving project metadata...')
        const { data, error } = await supabase
            .from('projects')
            .insert({
                title,
                audio_url: audioUrl,
                xml_url: xmlUrl,
                anchors: anchors
            })
            .select()

        if (error) throw error
        return data[0]
    },

    // Fetch all projects
    async getProjects(): Promise<Project[]> {
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .order('created_at', { ascending: false })

        if (error) throw error
        return data || []
    }
}
