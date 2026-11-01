export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      agent_requests: {
        Row: {
          at: string
          client: string
          id: number
          ip_hash: string | null
          ms: number
          paper: string | null
          ref: string | null
          status: number
          surface: string
          tool: string | null
          user_agent: string | null
        }
        Insert: {
          at?: string
          client: string
          id?: number
          ip_hash?: string | null
          ms: number
          paper?: string | null
          ref?: string | null
          status: number
          surface: string
          tool?: string | null
          user_agent?: string | null
        }
        Update: {
          at?: string
          client?: string
          id?: number
          ip_hash?: string | null
          ms?: number
          paper?: string | null
          ref?: string | null
          status?: number
          surface?: string
          tool?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      blobs: {
        Row: {
          content_type: string
          created_at: string
          sha: string
          size: number
        }
        Insert: {
          content_type: string
          created_at?: string
          sha: string
          size: number
        }
        Update: {
          content_type?: string
          created_at?: string
          sha?: string
          size?: number
        }
        Relationships: []
      }
      catalog_meta: {
        Row: {
          key: string
          value: Json
        }
        Insert: {
          key: string
          value: Json
        }
        Update: {
          key?: string
          value?: Json
        }
        Relationships: []
      }
      families: {
        Row: {
          description: string
          discipline: string
          discipline_slug: string
          has_lean: boolean
          member_count: number
          number: number
          position: number
          reasoning_trace: string | null
          title: string
        }
        Insert: {
          description: string
          discipline: string
          discipline_slug: string
          has_lean?: boolean
          member_count: number
          number: number
          position: number
          reasoning_trace?: string | null
          title: string
        }
        Update: {
          description?: string
          discipline?: string
          discipline_slug?: string
          has_lean?: boolean
          member_count?: number
          number?: number
          position?: number
          reasoning_trace?: string | null
          title?: string
        }
        Relationships: []
      }
      manuscripts: {
        Row: {
          abstract: string
          dir: string
          family_number: number
          has_lean: boolean
          pdf_file: string
          position: number
          published_on: string | null
          title: string
        }
        Insert: {
          abstract: string
          dir: string
          family_number: number
          has_lean?: boolean
          pdf_file: string
          position: number
          published_on?: string | null
          title: string
        }
        Update: {
          abstract?: string
          dir?: string
          family_number?: number
          has_lean?: boolean
          pdf_file?: string
          position?: number
          published_on?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "manuscripts_family_number_fkey"
            columns: ["family_number"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["number"]
          },
        ]
      }
      papers: {
        Row: {
          authors: string[]
          created_at: string
          digest: Json | null
          id: string
          latest_run_id: string | null
          manuscript_dir: string | null
          public: boolean
          slug: string
          source_kind: string
          source_ref: string
          tier: string | null
          title: string
          updated_at: string
        }
        Insert: {
          authors?: string[]
          created_at?: string
          digest?: Json | null
          id?: string
          latest_run_id?: string | null
          manuscript_dir?: string | null
          public?: boolean
          slug: string
          source_kind: string
          source_ref: string
          tier?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          authors?: string[]
          created_at?: string
          digest?: Json | null
          id?: string
          latest_run_id?: string | null
          manuscript_dir?: string | null
          public?: boolean
          slug?: string
          source_kind?: string
          source_ref?: string
          tier?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      review_items: {
        Row: {
          decided_at: string | null
          decision: string | null
          id: string
          kind: string
          payload: Json
          run_id: string
        }
        Insert: {
          decided_at?: string | null
          decision?: string | null
          id?: string
          kind: string
          payload: Json
          run_id: string
        }
        Update: {
          decided_at?: string | null
          decision?: string | null
          id?: string
          kind?: string
          payload?: Json
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      run_events: {
        Row: {
          data: Json | null
          id: number
          level: string
          message: string
          run_id: string
          stage: string
          ts: string
        }
        Insert: {
          data?: Json | null
          id?: number
          level: string
          message: string
          run_id: string
          stage: string
          ts?: string
        }
        Update: {
          data?: Json | null
          id?: number
          level?: string
          message?: string
          run_id?: string
          stage?: string
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          agent_token: string | null
          budget_usd: number
          cost_usd: number
          error: string | null
          finished_at: string | null
          id: string
          metrics: Json | null
          paper_id: string
          parent_run_id: string | null
          profile: string
          progress: Json
          stage: string | null
          started_at: string
          status: string
          structure_method: string
        }
        Insert: {
          agent_token?: string | null
          budget_usd: number
          cost_usd?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          metrics?: Json | null
          paper_id: string
          parent_run_id?: string | null
          profile: string
          progress?: Json
          stage?: string | null
          started_at?: string
          status?: string
          structure_method: string
        }
        Update: {
          agent_token?: string | null
          budget_usd?: number
          cost_usd?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          metrics?: Json | null
          paper_id?: string
          parent_run_id?: string | null
          profile?: string
          progress?: Json
          stage?: string | null
          started_at?: string
          status?: string
          structure_method?: string
        }
        Relationships: [
          {
            foreignKeyName: "runs_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "paper_digest_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      source_assets: {
        Row: {
          blob_sha: string
          bytes: number
          id: string
          paper_id: string
          path: string
        }
        Insert: {
          blob_sha: string
          bytes: number
          id?: string
          paper_id: string
          path: string
        }
        Update: {
          blob_sha?: string
          bytes?: number
          id?: string
          paper_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_assets_blob_sha_fkey"
            columns: ["blob_sha"]
            isOneToOne: false
            referencedRelation: "blobs"
            referencedColumns: ["sha"]
          },
          {
            foreignKeyName: "source_assets_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "paper_digest_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_assets_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          bytes: number
          content: string
          id: string
          paper_id: string
          path: string
        }
        Insert: {
          bytes: number
          content: string
          id?: string
          paper_id: string
          path: string
        }
        Update: {
          bytes?: number
          content?: string
          id?: string
          paper_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "sources_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "paper_digest_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sources_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_outputs: {
        Row: {
          created_at: string
          payload: Json
          run_id: string
          stage: string
        }
        Insert: {
          created_at?: string
          payload: Json
          run_id: string
          stage: string
        }
        Update: {
          created_at?: string
          payload?: Json
          run_id?: string
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_outputs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      paper_digest_stats: {
        Row: {
          authors: string[] | null
          created_at: string | null
          friction: number | null
          has_digest: boolean | null
          headline: string | null
          id: string | null
          manuscript_dir: string | null
          nodes: number | null
          novel: number | null
          pages: number | null
          public: boolean | null
          sections: number | null
          slug: string | null
          source_ref: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          authors?: string[] | null
          created_at?: string | null
          friction?: never
          has_digest?: never
          headline?: never
          id?: string | null
          manuscript_dir?: string | null
          nodes?: never
          novel?: never
          pages?: never
          public?: boolean | null
          sections?: never
          slug?: string | null
          source_ref?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          authors?: string[] | null
          created_at?: string | null
          friction?: never
          has_digest?: never
          headline?: never
          id?: string | null
          manuscript_dir?: string | null
          nodes?: never
          novel?: never
          pages?: never
          public?: boolean | null
          sections?: never
          slug?: string | null
          source_ref?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_run_cost: {
        Args: { p_run_id: string; p_usd: number }
        Returns: undefined
      }
      agent_request_stats: { Args: { p_days?: number }; Returns: Json }
      applied_migration_count: { Args: never; Returns: number }
      bump_run_progress: {
        Args: { p_by?: number; p_key: string; p_run_id: string }
        Returns: undefined
      }
      claim_agent_trace: {
        Args: { p_max_cost: number; p_max_seq: number; p_run_id: string }
        Returns: {
          cost: number
          seq: number
        }[]
      }
      patch_run_progress: {
        Args: { p_patch: Json; p_run_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
