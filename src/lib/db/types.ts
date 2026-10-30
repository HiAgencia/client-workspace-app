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
          node_id: string | null
          owner_id: string
          parts: Json
          role: string
          seq: number
        }
        Insert: {
          created_at?: string
          id?: string
          node_id?: string | null
          owner_id?: string
          parts: Json
          role: string
          seq?: never
        }
        Update: {
          created_at?: string
          id?: string
          node_id?: string | null
          owner_id?: string
          parts?: Json
          role?: string
          seq?: never
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
      daily_reviews: {
        Row: {
          attempt_started_at: string | null
          created_at: string
          day: string
          failures: number
          finished_at: string | null
          heartbeat_at: string | null
          id: string
          instruction: string
          owner_id: string
          provider: string
          requested: boolean
          task_ids: string[]
        }
        Insert: {
          attempt_started_at?: string | null
          created_at?: string
          day: string
          failures?: number
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          instruction: string
          owner_id?: string
          provider: string
          requested?: boolean
          task_ids?: string[]
        }
        Update: {
          attempt_started_at?: string | null
          created_at?: string
          day?: string
          failures?: number
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          instruction?: string
          owner_id?: string
          provider?: string
          requested?: boolean
          task_ids?: string[]
        }
        Relationships: []
      }
      demo_mail: {
        Row: {
          account_id: string
          created_at: string
          from_email: string
          from_name: string | null
          gmail_id: string
          html: string | null
          id: string
          important: boolean
          owner_id: string
          received_at: string
          snippet: string
          subject: string
          text_body: string | null
          thread_id: string
          to_emails: string[]
          unread: boolean
        }
        Insert: {
          account_id: string
          created_at?: string
          from_email: string
          from_name?: string | null
          gmail_id?: string
          html?: string | null
          id?: string
          important?: boolean
          owner_id: string
          received_at: string
          snippet?: string
          subject?: string
          text_body?: string | null
          thread_id?: string
          to_emails?: string[]
          unread?: boolean
        }
        Update: {
          account_id?: string
          created_at?: string
          from_email?: string
          from_name?: string | null
          gmail_id?: string
          html?: string | null
          id?: string
          important?: boolean
          owner_id?: string
          received_at?: string
          snippet?: string
          subject?: string
          text_body?: string | null
          thread_id?: string
          to_emails?: string[]
          unread?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "demo_mail_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "google_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          agent_label: string | null
          all_day: boolean
          body: string | null
          changed_agent_label: string | null
          changed_source: Database["public"]["Enums"]["item_source"]
          created_at: string
          deleted_at: string | null
          ends_at: string | null
          ends_on: string | null
          id: string
          node_id: string | null
          owner_id: string
          source: Database["public"]["Enums"]["item_source"]
          starts_at: string | null
          starts_on: string | null
          title: string
          updated_at: string
        }
        Insert: {
          agent_label?: string | null
          all_day?: boolean
          body?: string | null
          changed_agent_label?: string | null
          changed_source?: Database["public"]["Enums"]["item_source"]
          created_at?: string
          deleted_at?: string | null
          ends_at?: string | null
          ends_on?: string | null
          id?: string
          node_id?: string | null
          owner_id?: string
          source?: Database["public"]["Enums"]["item_source"]
          starts_at?: string | null
          starts_on?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          agent_label?: string | null
          all_day?: boolean
          body?: string | null
          changed_agent_label?: string | null
          changed_source?: Database["public"]["Enums"]["item_source"]
          created_at?: string
          deleted_at?: string | null
          ends_at?: string | null
          ends_on?: string | null
          id?: string
          node_id?: string | null
          owner_id?: string
          source?: Database["public"]["Enums"]["item_source"]
          starts_at?: string | null
          starts_on?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_node_same_owner"
            columns: ["node_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id", "owner_id"]
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
      item_events: {
        Row: {
          account_id: string | null
          calendar_id: string | null
          created_at: string
          event_id: string | null
          google_event_id: string | null
          item_id: string
        }
        Insert: {
          account_id?: string | null
          calendar_id?: string | null
          created_at?: string
          event_id?: string | null
          google_event_id?: string | null
          item_id: string
        }
        Update: {
          account_id?: string | null
          calendar_id?: string | null
          created_at?: string
          event_id?: string | null
          google_event_id?: string | null
          item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "google_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          agent_label: string | null
          body: string | null
          changed_agent_label: string | null
          changed_source: Database["public"]["Enums"]["item_source"]
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          due_on: string | null
          due_time: string | null
          id: string
          node_id: string | null
          owner_id: string
          parent_item_id: string | null
          position: number
          priority: number | null
          source: Database["public"]["Enums"]["item_source"]
          status: Database["public"]["Enums"]["item_status"]
          title: string
          type: Database["public"]["Enums"]["item_type"]
          updated_at: string
        }
        Insert: {
          agent_label?: string | null
          body?: string | null
          changed_agent_label?: string | null
          changed_source?: Database["public"]["Enums"]["item_source"]
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          due_on?: string | null
          due_time?: string | null
          id?: string
          node_id?: string | null
          owner_id?: string
          parent_item_id?: string | null
          position?: number
          priority?: number | null
          source?: Database["public"]["Enums"]["item_source"]
          status?: Database["public"]["Enums"]["item_status"]
          title: string
          type: Database["public"]["Enums"]["item_type"]
          updated_at?: string
        }
        Update: {
          agent_label?: string | null
          body?: string | null
          changed_agent_label?: string | null
          changed_source?: Database["public"]["Enums"]["item_source"]
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          due_on?: string | null
          due_time?: string | null
          id?: string
          node_id?: string | null
          owner_id?: string
          parent_item_id?: string | null
          position?: number
          priority?: number | null
          source?: Database["public"]["Enums"]["item_source"]
          status?: Database["public"]["Enums"]["item_status"]
          title?: string
          type?: Database["public"]["Enums"]["item_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_node_same_owner"
            columns: ["node_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_links: {
        Row: {
          account_id: string
          created_at: string
          id: string
          item_id: string | null
          message_id: string
          node_id: string | null
          owner_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          item_id?: string | null
          message_id: string
          node_id?: string | null
          owner_id?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          item_id?: string | null
          message_id?: string
          node_id?: string | null
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_links_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "google_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_links_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_links_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_opened: {
        Row: {
          account_id: string
          message_id: string
          opened_at: string
          owner_id: string
        }
        Insert: {
          account_id: string
          message_id: string
          opened_at?: string
          owner_id?: string
        }
        Update: {
          account_id?: string
          message_id?: string
          opened_at?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_opened_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "google_accounts"
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
      node_events: {
        Row: {
          account_id: string | null
          calendar_id: string | null
          created_at: string
          event_id: string | null
          google_event_id: string | null
          id: string
          node_id: string
        }
        Insert: {
          account_id?: string | null
          calendar_id?: string | null
          created_at?: string
          event_id?: string | null
          google_event_id?: string | null
          id?: string
          node_id: string
        }
        Update: {
          account_id?: string | null
          calendar_id?: string | null
          created_at?: string
          event_id?: string | null
          google_event_id?: string | null
          id?: string
          node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "google_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_events_node_id_fkey"
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
          color: string | null
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
          color?: string | null
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
          color?: string | null
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
      preferences: {
        Row: {
          boards: Json
          created_at: string
          daily_review: boolean
          daily_review_instruction: string
          layouts: Json
          owner_id: string
          updated_at: string
        }
        Insert: {
          boards?: Json
          created_at?: string
          daily_review?: boolean
          daily_review_instruction?: string
          layouts?: Json
          owner_id?: string
          updated_at?: string
        }
        Update: {
          boards?: Json
          created_at?: string
          daily_review?: boolean
          daily_review_instruction?: string
          layouts?: Json
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      review_actions: {
        Row: {
          after: Json
          before: Json
          created_at: string
          id: string
          item_id: string
          kind: string
          owner_id: string
          review_id: string
          undone_at: string | null
        }
        Insert: {
          after: Json
          before: Json
          created_at?: string
          id?: string
          item_id: string
          kind: string
          owner_id?: string
          review_id: string
          undone_at?: string | null
        }
        Update: {
          after?: Json
          before?: Json
          created_at?: string
          id?: string
          item_id?: string
          kind?: string
          owner_id?: string
          review_id?: string
          undone_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_actions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_actions_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "daily_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      revisions: {
        Row: {
          agent_label: string | null
          created_at: string
          event_id: string | null
          id: string
          item_id: string | null
          snapshot: Json
          source: Database["public"]["Enums"]["item_source"]
        }
        Insert: {
          agent_label?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          item_id?: string | null
          snapshot: Json
          source: Database["public"]["Enums"]["item_source"]
        }
        Update: {
          agent_label?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          item_id?: string | null
          snapshot?: Json
          source?: Database["public"]["Enums"]["item_source"]
        }
        Relationships: [
          {
            foreignKeyName: "revisions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revisions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      task_mail: {
        Row: {
          account_id: string | null
          checked_at: string | null
          created_at: string
          decided_account_id: string | null
          decided_message_id: string | null
          dismissed: string[]
          expect_from: string | null
          item_id: string
          owner_id: string
          sentence: string | null
          status: string
          updated_at: string
          waits_for: string | null
        }
        Insert: {
          account_id?: string | null
          checked_at?: string | null
          created_at?: string
          decided_account_id?: string | null
          decided_message_id?: string | null
          dismissed?: string[]
          expect_from?: string | null
          item_id: string
          owner_id?: string
          sentence?: string | null
          status?: string
          updated_at?: string
          waits_for?: string | null
        }
        Update: {
          account_id?: string | null
          checked_at?: string | null
          created_at?: string
          decided_account_id?: string | null
          decided_message_id?: string | null
          dismissed?: string[]
          expect_from?: string | null
          item_id?: string
          owner_id?: string
          sentence?: string | null
          status?: string
          updated_at?: string
          waits_for?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_mail_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "google_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_mail_decided_account_id_fkey"
            columns: ["decided_account_id"]
            isOneToOne: false
            referencedRelation: "google_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_mail_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
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
      anonymous_usage: {
        Args: { p_day: string; p_kind: string }
        Returns: number
      }
      delete_item_branch: {
        Args: {
          p_agent_label: string
          p_item: string
          p_source: Database["public"]["Enums"]["item_source"]
        }
        Returns: {
          agent_label: string | null
          body: string | null
          changed_agent_label: string | null
          changed_source: Database["public"]["Enums"]["item_source"]
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          due_on: string | null
          due_time: string | null
          id: string
          node_id: string | null
          owner_id: string
          parent_item_id: string | null
          position: number
          priority: number | null
          source: Database["public"]["Enums"]["item_source"]
          status: Database["public"]["Enums"]["item_status"]
          title: string
          type: Database["public"]["Enums"]["item_type"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      dismiss_task_reply: {
        Args: {
          p_dismissed: boolean
          p_item: string
          p_owner: string
          p_reply: string
        }
        Returns: string[]
      }
      move_item_branch: {
        Args: {
          p_agent_label: string
          p_item: string
          p_node: string
          p_parent: string
          p_source: Database["public"]["Enums"]["item_source"]
        }
        Returns: {
          agent_label: string | null
          body: string | null
          changed_agent_label: string | null
          changed_source: Database["public"]["Enums"]["item_source"]
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          due_on: string | null
          due_time: string | null
          id: string
          node_id: string | null
          owner_id: string
          parent_item_id: string | null
          position: number
          priority: number | null
          source: Database["public"]["Enums"]["item_source"]
          status: Database["public"]["Enums"]["item_status"]
          title: string
          type: Database["public"]["Enums"]["item_type"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      node_subtree: {
        Args: { root: string }
        Returns: {
          id: string
        }[]
      }
      plant_demo_accounts: {
        Args: { p_accounts: Json }
        Returns: {
          account_id: string
          email: string
        }[]
      }
      plant_demo_mail: { Args: { p_messages: Json }; Returns: number }
      reorder_item_positions: {
        Args: { p_items: string[] }
        Returns: {
          agent_label: string | null
          body: string | null
          changed_agent_label: string | null
          changed_source: Database["public"]["Enums"]["item_source"]
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          due_on: string | null
          due_time: string | null
          id: string
          node_id: string | null
          owner_id: string
          parent_item_id: string | null
          position: number
          priority: number | null
          source: Database["public"]["Enums"]["item_source"]
          status: Database["public"]["Enums"]["item_status"]
          title: string
          type: Database["public"]["Enums"]["item_type"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reset_demo: { Args: never; Returns: boolean }
      reset_demo_usage: { Args: { p_owner: string }; Returns: number }
      restore_item_branch: {
        Args: {
          p_agent_label: string
          p_item: string
          p_source: Database["public"]["Enums"]["item_source"]
        }
        Returns: {
          agent_label: string | null
          body: string | null
          changed_agent_label: string | null
          changed_source: Database["public"]["Enums"]["item_source"]
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          due_on: string | null
          due_time: string | null
          id: string
          node_id: string | null
          owner_id: string
          parent_item_id: string | null
          position: number
          priority: number | null
          source: Database["public"]["Enums"]["item_source"]
          status: Database["public"]["Enums"]["item_status"]
          title: string
          type: Database["public"]["Enums"]["item_type"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      review_complete_task: {
        Args: { p_item: string; p_review: string }
        Returns: {
          after: Json
          before: Json
          created_at: string
          id: string
          item_id: string
          kind: string
          owner_id: string
          review_id: string
          undone_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "review_actions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      review_write_mail_status: {
        Args: {
          p_account: string
          p_item: string
          p_message: string
          p_review: string
          p_sentence: string
          p_status: string
        }
        Returns: {
          after: Json
          before: Json
          created_at: string
          id: string
          item_id: string
          kind: string
          owner_id: string
          review_id: string
          undone_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "review_actions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      save_preferences: {
        Args: {
          p_board: Json
          p_board_clear: boolean
          p_daily_review: boolean
          p_instruction: string
          p_layout: string
          p_layout_clear: boolean
          p_page: string
        }
        Returns: {
          boards: Json
          created_at: string
          daily_review: boolean
          daily_review_instruction: string
          layouts: Json
          owner_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "preferences"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      seed_demo: {
        Args: { p_today: string; p_zone?: string }
        Returns: boolean
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
      working_minutes_before: {
        Args: { p_minutes: number; p_to: string; p_zone?: string }
        Returns: string
      }
    }
    Enums: {
      account_status: "active" | "error" | "revoked"
      item_source: "manual" | "chat" | "agent" | "review"
      item_status: "open" | "done"
      item_type: "task" | "decision" | "link" | "review" | "note"
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
      item_source: ["manual", "chat", "agent", "review"],
      item_status: ["open", "done"],
      item_type: ["task", "decision", "link", "review", "note"],
      node_kind: ["client", "project", "subproject"],
    },
  },
} as const
