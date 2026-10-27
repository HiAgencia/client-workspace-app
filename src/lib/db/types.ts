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
      account_calendars: {
        Row: {
          account_id: string
          calendar_id: string
          color: string | null
          selected: boolean
          summary: string
        }
        Insert: {
          account_id: string
          calendar_id: string
          color?: string | null
          selected?: boolean
          summary: string
        }
        Update: {
          account_id?: string
          calendar_id?: string
          color?: string | null
          selected?: boolean
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_calendars_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "google_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tokens: {
        Row: {
          created_at: string
          id: string
          label: string
          last_used_at: string | null
          node_id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          last_used_at?: string | null
          node_id: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          last_used_at?: string | null
          node_id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tokens_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          created_at: string
          id: string
          node_id: string
          parts: Json
          role: string
        }
        Insert: {
          created_at?: string
          id?: string
          node_id: string
          parts: Json
          role: string
        }
        Update: {
          created_at?: string
          id?: string
          node_id?: string
          parts?: Json
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      google_accounts: {
        Row: {
          access_token: string | null
          access_token_expires_at: string | null
          created_at: string
          email: string
          id: string
          is_demo: boolean
          owner_id: string
          refresh_token: string | null
          scopes: string[]
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          access_token_expires_at?: string | null
          created_at?: string
          email: string
          id?: string
          is_demo?: boolean
          owner_id: string
          refresh_token?: string | null
          scopes?: string[]
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          access_token_expires_at?: string | null
          created_at?: string
          email?: string
          id?: string
          is_demo?: boolean
          owner_id?: string
          refresh_token?: string | null
          scopes?: string[]
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Relationships: []
      }
      items: {
        Row: {
          agent_label: string | null
          body: string | null
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          due_on: string | null
          id: string
          node_id: string
          priority: number | null
          source: Database["public"]["Enums"]["item_source"]
          status: Database["public"]["Enums"]["item_status"]
          title: string
          type: Database["public"]["Enums"]["item_type"]
          updated_at: string
          url: string | null
        }
        Insert: {
          agent_label?: string | null
          body?: string | null
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          due_on?: string | null
          id?: string
          node_id: string
          priority?: number | null
          source?: Database["public"]["Enums"]["item_source"]
          status?: Database["public"]["Enums"]["item_status"]
          title: string
          type: Database["public"]["Enums"]["item_type"]
          updated_at?: string
          url?: string | null
        }
        Update: {
          agent_label?: string | null
          body?: string | null
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          due_on?: string | null
          id?: string
          node_id?: string
          priority?: number | null
          source?: Database["public"]["Enums"]["item_source"]
          status?: Database["public"]["Enums"]["item_status"]
          title?: string
          type?: Database["public"]["Enums"]["item_type"]
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      node_accounts: {
        Row: {
          account_id: string
          created_at: string
          node_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          node_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "google_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_accounts_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      nodes: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["node_kind"]
          name: string
          owner_id: string
          parent_id: string | null
          position: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["node_kind"]
          name: string
          owner_id: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["node_kind"]
          name?: string
          owner_id?: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nodes_parent_same_owner"
            columns: ["parent_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      usage_counters: {
        Row: {
          count: number
          day: string
          kind: string
          owner_id: string
        }
        Insert: {
          count?: number
          day: string
          kind: string
          owner_id: string
        }
        Update: {
          count?: number
          day?: string
          kind?: string
          owner_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      node_subtree: {
        Args: { root: string }
        Returns: {
          id: string
        }[]
      }
      take_usage: {
        Args: { p_cap: number; p_day: string; p_kind: string; p_owner: string }
        Returns: number
      }
      visible_accounts: {
        Args: { node: string }
        Returns: {
          account_id: string
          from_node_id: string
        }[]
      }
    }
    Enums: {
      account_status: "active" | "error" | "revoked"
      item_source: "manual" | "chat" | "agent"
      item_status: "open" | "done"
      item_type: "task" | "decision" | "link" | "review"
      node_kind: "client" | "project" | "subproject"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_status: ["active", "error", "revoked"],
      item_source: ["manual", "chat", "agent"],
      item_status: ["open", "done"],
      item_type: ["task", "decision", "link", "review"],
      node_kind: ["client", "project", "subproject"],
    },
  },
} as const
