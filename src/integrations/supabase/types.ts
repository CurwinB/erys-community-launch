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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_wallets: {
        Row: {
          added_at: string
          email: string | null
          wallet_address: string
        }
        Insert: {
          added_at?: string
          email?: string | null
          wallet_address: string
        }
        Update: {
          added_at?: string
          email?: string | null
          wallet_address?: string
        }
        Relationships: []
      }
      affiliate_earnings: {
        Row: {
          affiliate_id: string
          amount_lamports: number
          created_at: string
          id: string
          launch_id: string
          status: string
          tx_signature: string | null
          wallet_address: string
        }
        Insert: {
          affiliate_id: string
          amount_lamports: number
          created_at?: string
          id?: string
          launch_id: string
          status?: string
          tx_signature?: string | null
          wallet_address: string
        }
        Update: {
          affiliate_id?: string
          amount_lamports?: number
          created_at?: string
          id?: string
          launch_id?: string
          status?: string
          tx_signature?: string | null
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_earnings_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_earnings_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_earnings_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches_public"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_referrals: {
        Row: {
          affiliate_id: string
          attributed_at: string
          referral_code: string
          wallet_address: string
        }
        Insert: {
          affiliate_id: string
          attributed_at?: string
          referral_code: string
          wallet_address: string
        }
        Update: {
          affiliate_id?: string
          attributed_at?: string
          referral_code?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_referrals_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliates: {
        Row: {
          created_at: string
          created_by_admin_wallet: string | null
          id: string
          referral_code: string
          status: string
          updated_at: string
          wallet_address: string
        }
        Insert: {
          created_at?: string
          created_by_admin_wallet?: string | null
          id?: string
          referral_code: string
          status?: string
          updated_at?: string
          wallet_address: string
        }
        Update: {
          created_at?: string
          created_by_admin_wallet?: string | null
          id?: string
          referral_code?: string
          status?: string
          updated_at?: string
          wallet_address?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      codev_payouts: {
        Row: {
          amount_lamports: number
          created_at: string
          cycle_id: string | null
          id: string
          launch_id: string
          tx_signature: string
          wallet_address: string
        }
        Insert: {
          amount_lamports: number
          created_at?: string
          cycle_id?: string | null
          id?: string
          launch_id: string
          tx_signature: string
          wallet_address: string
        }
        Update: {
          amount_lamports?: number
          created_at?: string
          cycle_id?: string | null
          id?: string
          launch_id?: string
          tx_signature?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "codev_payouts_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "codev_payouts_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches_public"
            referencedColumns: ["id"]
          },
        ]
      }
      contributions: {
        Row: {
          amount_lamports: number
          basis_points: number | null
          contributed_at: string
          distribution_error: string | null
          distribution_tx_signature: string | null
          id: string
          is_fee_claimer: boolean | null
          launch_id: string
          pending_orphan_refund: boolean
          refund_shortfall_lamports: number | null
          refund_tx_signature: string | null
          token_amount: number | null
          token_delivery_wallet: string | null
          tokens_distributed: boolean | null
          tx_signature: string
          wallet_address: string
        }
        Insert: {
          amount_lamports: number
          basis_points?: number | null
          contributed_at?: string
          distribution_error?: string | null
          distribution_tx_signature?: string | null
          id?: string
          is_fee_claimer?: boolean | null
          launch_id: string
          pending_orphan_refund?: boolean
          refund_shortfall_lamports?: number | null
          refund_tx_signature?: string | null
          token_amount?: number | null
          token_delivery_wallet?: string | null
          tokens_distributed?: boolean | null
          tx_signature: string
          wallet_address: string
        }
        Update: {
          amount_lamports?: number
          basis_points?: number | null
          contributed_at?: string
          distribution_error?: string | null
          distribution_tx_signature?: string | null
          id?: string
          is_fee_claimer?: boolean | null
          launch_id?: string
          pending_orphan_refund?: boolean
          refund_shortfall_lamports?: number | null
          refund_tx_signature?: string | null
          token_amount?: number | null
          token_delivery_wallet?: string | null
          tokens_distributed?: boolean | null
          tx_signature?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "contributions_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contributions_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches_public"
            referencedColumns: ["id"]
          },
        ]
      }
      custodial_wallet_locks: {
        Row: {
          lock_key: string
          locked_at: string
          locked_by: string
        }
        Insert: {
          lock_key: string
          locked_at?: string
          locked_by: string
        }
        Update: {
          lock_key?: string
          locked_at?: string
          locked_by?: string
        }
        Relationships: []
      }
      fee_allocations: {
        Row: {
          basis_points: number
          claim_error: string | null
          claim_locked_at: string | null
          claim_state: string
          claim_tx_signature: string | null
          claim_worker_id: string | null
          claimed_at: string | null
          contribution_id: string
          created_at: string
          cycle_id: string
          delivery_wallet: string | null
          id: string
          lamports: number
          launch_id: string
          wallet_address: string
        }
        Insert: {
          basis_points: number
          claim_error?: string | null
          claim_locked_at?: string | null
          claim_state?: string
          claim_tx_signature?: string | null
          claim_worker_id?: string | null
          claimed_at?: string | null
          contribution_id: string
          created_at?: string
          cycle_id: string
          delivery_wallet?: string | null
          id?: string
          lamports: number
          launch_id: string
          wallet_address: string
        }
        Update: {
          basis_points?: number
          claim_error?: string | null
          claim_locked_at?: string | null
          claim_state?: string
          claim_tx_signature?: string | null
          claim_worker_id?: string | null
          claimed_at?: string | null
          contribution_id?: string
          created_at?: string
          cycle_id?: string
          delivery_wallet?: string | null
          id?: string
          lamports?: number
          launch_id?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_allocations_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "fee_harvest_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_harvest_cycles: {
        Row: {
          claim_tx_signature: string | null
          contributor_lamports: number
          created_at: string
          escrow_balance_after: number | null
          escrow_balance_before: number | null
          gross_lamports: number
          id: string
          launch_id: string
          notes: string | null
          treasury_lamports: number
          treasury_tx_signature: string | null
          vault_balance_before: number | null
        }
        Insert: {
          claim_tx_signature?: string | null
          contributor_lamports: number
          created_at?: string
          escrow_balance_after?: number | null
          escrow_balance_before?: number | null
          gross_lamports: number
          id?: string
          launch_id: string
          notes?: string | null
          treasury_lamports: number
          treasury_tx_signature?: string | null
          vault_balance_before?: number | null
        }
        Update: {
          claim_tx_signature?: string | null
          contributor_lamports?: number
          created_at?: string
          escrow_balance_after?: number | null
          escrow_balance_before?: number | null
          gross_lamports?: number
          id?: string
          launch_id?: string
          notes?: string | null
          treasury_lamports?: number
          treasury_tx_signature?: string | null
          vault_balance_before?: number | null
        }
        Relationships: []
      }
      launch_codevs: {
        Row: {
          contribution_lamports: number
          id: string
          joined_at: string
          launch_id: string
          paid_lamports: number
          pending_lamports: number
          wallet_address: string
        }
        Insert: {
          contribution_lamports?: number
          id?: string
          joined_at?: string
          launch_id: string
          paid_lamports?: number
          pending_lamports?: number
          wallet_address: string
        }
        Update: {
          contribution_lamports?: number
          id?: string
          joined_at?: string
          launch_id?: string
          paid_lamports?: number
          pending_lamports?: number
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_codevs_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_codevs_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches_public"
            referencedColumns: ["id"]
          },
        ]
      }
      launches: {
        Row: {
          category: string | null
          claimer_count: number | null
          codev_mode: string
          codev_roster_locked_at: string | null
          codev_sharing_enabled: boolean
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_contributor_total_lamports: number
          fee_harvest_consecutive_empty: number
          fee_harvest_last_attempt_at: string | null
          fee_harvest_last_error: string | null
          fee_harvest_last_success_at: string | null
          fee_harvest_locked_at: string | null
          fee_harvest_state: string
          fee_harvest_throttle_until: string | null
          fee_harvest_total_lamports: number
          fee_harvest_worker_id: string | null
          fee_share_config_key: string | null
          fee_treasury_total_lamports: number
          hook: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_checklist: Json | null
          launch_datetime: string | null
          launch_window: string | null
          lightning_wallet_encrypted_api_key: string | null
          lightning_wallet_encrypted_private_key: string | null
          lightning_wallet_public_key: string | null
          max_contribution_lamports: number | null
          meme_images: string[]
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_refund_owed_lamports: number | null
          processing_fee_tx_signature: string | null
          profile_description: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          referred_by_affiliate_id: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_handle: string | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }
        Insert: {
          category?: string | null
          claimer_count?: number | null
          codev_mode?: string
          codev_roster_locked_at?: string | null
          codev_sharing_enabled?: boolean
          created_at?: string
          created_by_wallet: string
          creator_delivery_wallet?: string | null
          description?: string | null
          distribution_completed?: boolean | null
          distribution_completed_at?: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors?: number | null
          execution_attempts?: number
          execution_error?: string | null
          fee_contributor_total_lamports?: number
          fee_harvest_consecutive_empty?: number
          fee_harvest_last_attempt_at?: string | null
          fee_harvest_last_error?: string | null
          fee_harvest_last_success_at?: string | null
          fee_harvest_locked_at?: string | null
          fee_harvest_state?: string
          fee_harvest_throttle_until?: string | null
          fee_harvest_total_lamports?: number
          fee_harvest_worker_id?: string | null
          fee_share_config_key?: string | null
          fee_treasury_total_lamports?: number
          hook?: string | null
          id?: string
          image_url?: string | null
          ipfs_metadata_url?: string | null
          is_sponsored?: boolean | null
          launch_checklist?: Json | null
          launch_datetime?: string | null
          launch_window?: string | null
          lightning_wallet_encrypted_api_key?: string | null
          lightning_wallet_encrypted_private_key?: string | null
          lightning_wallet_public_key?: string | null
          max_contribution_lamports?: number | null
          meme_images?: string[]
          min_contribution_lamports: number
          platform?: string
          processing_fee_lamports?: number
          processing_fee_refund_owed_lamports?: number | null
          processing_fee_tx_signature?: string | null
          profile_description?: string | null
          pumpfun_consecutive_empty_claims?: number
          pumpfun_creator_fees_distributed?: number | null
          pumpfun_creator_vault_balance_lamports?: number | null
          pumpfun_creator_vault_checked_at?: string | null
          pumpfun_fees_claimed_total?: number | null
          pumpfun_fees_last_claimed_at?: string | null
          pumpfun_last_claim_attempt_at?: string | null
          pumpfun_last_claim_error?: string | null
          pumpfun_launch_signature?: string | null
          pumpfun_low_volume_throttle_until?: string | null
          pumpfun_mint_keypair_encrypted?: string | null
          pumpportal_wallet_pubkey?: string | null
          referred_by_affiliate_id?: string | null
          sponsor_funding_attempts?: number
          sponsor_funding_error?: string | null
          sponsor_link_claimed_at?: string | null
          sponsor_link_expires_at?: string | null
          sponsor_link_token?: string | null
          sponsor_recovery_amount_lamports?: number | null
          sponsor_recovery_attempts?: number
          sponsor_recovery_completed_at?: string | null
          sponsor_recovery_error?: string | null
          sponsor_recovery_tx_signature?: string | null
          sponsored_amount_lamports?: number | null
          sponsored_by?: string | null
          sponsored_tx_signature?: string | null
          status?: Database["public"]["Enums"]["launch_status"]
          telegram_url?: string | null
          token_mint_address?: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed?: number | null
          twitter_handle?: string | null
          twitter_url?: string | null
          website_url?: string | null
          worker_id?: string | null
          worker_locked_at?: string | null
        }
        Update: {
          category?: string | null
          claimer_count?: number | null
          codev_mode?: string
          codev_roster_locked_at?: string | null
          codev_sharing_enabled?: boolean
          created_at?: string
          created_by_wallet?: string
          creator_delivery_wallet?: string | null
          description?: string | null
          distribution_completed?: boolean | null
          distribution_completed_at?: string | null
          escrow_wallet_encrypted_private_key?: string
          escrow_wallet_public_key?: string
          excluded_contributors?: number | null
          execution_attempts?: number
          execution_error?: string | null
          fee_contributor_total_lamports?: number
          fee_harvest_consecutive_empty?: number
          fee_harvest_last_attempt_at?: string | null
          fee_harvest_last_error?: string | null
          fee_harvest_last_success_at?: string | null
          fee_harvest_locked_at?: string | null
          fee_harvest_state?: string
          fee_harvest_throttle_until?: string | null
          fee_harvest_total_lamports?: number
          fee_harvest_worker_id?: string | null
          fee_share_config_key?: string | null
          fee_treasury_total_lamports?: number
          hook?: string | null
          id?: string
          image_url?: string | null
          ipfs_metadata_url?: string | null
          is_sponsored?: boolean | null
          launch_checklist?: Json | null
          launch_datetime?: string | null
          launch_window?: string | null
          lightning_wallet_encrypted_api_key?: string | null
          lightning_wallet_encrypted_private_key?: string | null
          lightning_wallet_public_key?: string | null
          max_contribution_lamports?: number | null
          meme_images?: string[]
          min_contribution_lamports?: number
          platform?: string
          processing_fee_lamports?: number
          processing_fee_refund_owed_lamports?: number | null
          processing_fee_tx_signature?: string | null
          profile_description?: string | null
          pumpfun_consecutive_empty_claims?: number
          pumpfun_creator_fees_distributed?: number | null
          pumpfun_creator_vault_balance_lamports?: number | null
          pumpfun_creator_vault_checked_at?: string | null
          pumpfun_fees_claimed_total?: number | null
          pumpfun_fees_last_claimed_at?: string | null
          pumpfun_last_claim_attempt_at?: string | null
          pumpfun_last_claim_error?: string | null
          pumpfun_launch_signature?: string | null
          pumpfun_low_volume_throttle_until?: string | null
          pumpfun_mint_keypair_encrypted?: string | null
          pumpportal_wallet_pubkey?: string | null
          referred_by_affiliate_id?: string | null
          sponsor_funding_attempts?: number
          sponsor_funding_error?: string | null
          sponsor_link_claimed_at?: string | null
          sponsor_link_expires_at?: string | null
          sponsor_link_token?: string | null
          sponsor_recovery_amount_lamports?: number | null
          sponsor_recovery_attempts?: number
          sponsor_recovery_completed_at?: string | null
          sponsor_recovery_error?: string | null
          sponsor_recovery_tx_signature?: string | null
          sponsored_amount_lamports?: number | null
          sponsored_by?: string | null
          sponsored_tx_signature?: string | null
          status?: Database["public"]["Enums"]["launch_status"]
          telegram_url?: string | null
          token_mint_address?: string | null
          token_name?: string
          token_symbol?: string
          total_tokens_distributed?: number | null
          twitter_handle?: string | null
          twitter_url?: string | null
          website_url?: string | null
          worker_id?: string | null
          worker_locked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "launches_referred_by_affiliate_id_fkey"
            columns: ["referred_by_affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      lightning_wallets: {
        Row: {
          created_at: string
          encrypted_api_key: string
          encrypted_secret_key: string
          id: string
          last_used_at: string | null
          launch_count: number
          notes: string | null
          pubkey: string
          slot: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          encrypted_api_key: string
          encrypted_secret_key: string
          id?: string
          last_used_at?: string | null
          launch_count?: number
          notes?: string | null
          pubkey: string
          slot: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          encrypted_api_key?: string
          encrypted_secret_key?: string
          id?: string
          last_used_at?: string | null
          launch_count?: number
          notes?: string | null
          pubkey?: string
          slot?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_fee_claims: {
        Row: {
          amount_lamports: number
          claimed_at: string
          id: string
          tx_signature: string
        }
        Insert: {
          amount_lamports: number
          claimed_at?: string
          id?: string
          tx_signature: string
        }
        Update: {
          amount_lamports?: number
          claimed_at?: string
          id?: string
          tx_signature?: string
        }
        Relationships: []
      }
      pump_keypair_pool: {
        Row: {
          claimed_at: string | null
          claimed_by_launch_id: string | null
          created_at: string
          encrypted_private_key: string
          id: string
          public_key: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by_launch_id?: string | null
          created_at?: string
          encrypted_private_key: string
          id?: string
          public_key: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by_launch_id?: string | null
          created_at?: string
          encrypted_private_key?: string
          id?: string
          public_key?: string
        }
        Relationships: []
      }
      pumpfun_fee_sweeps: {
        Row: {
          amount_lamports: number
          created_at: string
          id: string
          launch_id: string | null
          notes: string | null
          source_wallet: string
          treasury_wallet: string
          tx_signature: string
        }
        Insert: {
          amount_lamports: number
          created_at?: string
          id?: string
          launch_id?: string | null
          notes?: string | null
          source_wallet: string
          treasury_wallet: string
          tx_signature: string
        }
        Update: {
          amount_lamports?: number
          created_at?: string
          id?: string
          launch_id?: string | null
          notes?: string | null
          source_wallet?: string
          treasury_wallet?: string
          tx_signature?: string
        }
        Relationships: []
      }
    }
    Views: {
      contributions_public: {
        Row: {
          amount_lamports: number | null
          contributed_at: string | null
          id: string | null
          launch_id: string | null
          wallet_address: string | null
        }
        Insert: {
          amount_lamports?: number | null
          contributed_at?: string | null
          id?: string | null
          launch_id?: string | null
          wallet_address?: string | null
        }
        Update: {
          amount_lamports?: number | null
          contributed_at?: string | null
          id?: string | null
          launch_id?: string | null
          wallet_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contributions_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contributions_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches_public"
            referencedColumns: ["id"]
          },
        ]
      }
      launches_public: {
        Row: {
          category: string | null
          claimer_count: number | null
          created_at: string | null
          created_by_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_public_key: string | null
          fee_share_config_key: string | null
          hook: string | null
          id: string | null
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_checklist: Json | null
          launch_datetime: string | null
          launch_window: string | null
          max_contribution_lamports: number | null
          meme_images: string[] | null
          min_contribution_lamports: number | null
          platform: string | null
          profile_description: string | null
          pumpfun_launch_signature: string | null
          sponsored_amount_lamports: number | null
          status: Database["public"]["Enums"]["launch_status"] | null
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string | null
          token_symbol: string | null
          total_tokens_distributed: number | null
          twitter_handle: string | null
          twitter_url: string | null
          website_url: string | null
        }
        Insert: {
          category?: string | null
          claimer_count?: number | null
          created_at?: string | null
          created_by_wallet?: string | null
          description?: string | null
          distribution_completed?: boolean | null
          distribution_completed_at?: string | null
          escrow_wallet_public_key?: string | null
          fee_share_config_key?: string | null
          hook?: string | null
          id?: string | null
          image_url?: string | null
          ipfs_metadata_url?: string | null
          is_sponsored?: boolean | null
          launch_checklist?: Json | null
          launch_datetime?: string | null
          launch_window?: string | null
          max_contribution_lamports?: number | null
          meme_images?: string[] | null
          min_contribution_lamports?: number | null
          platform?: string | null
          profile_description?: string | null
          pumpfun_launch_signature?: string | null
          sponsored_amount_lamports?: number | null
          status?: Database["public"]["Enums"]["launch_status"] | null
          telegram_url?: string | null
          token_mint_address?: string | null
          token_name?: string | null
          token_symbol?: string | null
          total_tokens_distributed?: number | null
          twitter_handle?: string | null
          twitter_url?: string | null
          website_url?: string | null
        }
        Update: {
          category?: string | null
          claimer_count?: number | null
          created_at?: string | null
          created_by_wallet?: string | null
          description?: string | null
          distribution_completed?: boolean | null
          distribution_completed_at?: string | null
          escrow_wallet_public_key?: string | null
          fee_share_config_key?: string | null
          hook?: string | null
          id?: string | null
          image_url?: string | null
          ipfs_metadata_url?: string | null
          is_sponsored?: boolean | null
          launch_checklist?: Json | null
          launch_datetime?: string | null
          launch_window?: string | null
          max_contribution_lamports?: number | null
          meme_images?: string[] | null
          min_contribution_lamports?: number | null
          platform?: string | null
          profile_description?: string | null
          pumpfun_launch_signature?: string | null
          sponsored_amount_lamports?: number | null
          status?: Database["public"]["Enums"]["launch_status"] | null
          telegram_url?: string | null
          token_mint_address?: string | null
          token_name?: string | null
          token_symbol?: string | null
          total_tokens_distributed?: number | null
          twitter_handle?: string | null
          twitter_url?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _gen_affiliate_code: { Args: never; Returns: string }
      accrue_codev_pending: {
        Args: { p_deltas: Json; p_launch_id: string }
        Returns: undefined
      }
      admin_create_affiliate: {
        Args: { p_admin_wallet: string; p_wallet: string }
        Returns: {
          created_at: string
          created_by_admin_wallet: string | null
          id: string
          referral_code: string
          status: string
          updated_at: string
          wallet_address: string
        }
        SetofOptions: {
          from: "*"
          to: "affiliates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_list_affiliates: {
        Args: { p_admin_wallet: string }
        Returns: {
          attributed_launches: number
          created_at: string
          id: string
          paid_out_lamports: number
          referral_code: string
          referred_wallets: number
          status: string
          wallet_address: string
        }[]
      }
      admin_list_contributions: {
        Args: { p_admin_wallet: string }
        Returns: {
          amount_lamports: number
          basis_points: number | null
          contributed_at: string
          distribution_error: string | null
          distribution_tx_signature: string | null
          id: string
          is_fee_claimer: boolean | null
          launch_id: string
          pending_orphan_refund: boolean
          refund_shortfall_lamports: number | null
          refund_tx_signature: string | null
          token_amount: number | null
          token_delivery_wallet: string | null
          tokens_distributed: boolean | null
          tx_signature: string
          wallet_address: string
        }[]
        SetofOptions: {
          from: "*"
          to: "contributions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_list_fee_harvest: {
        Args: { p_admin_wallet: string }
        Returns: {
          cycle_count: number
          fee_contributor_total_lamports: number
          fee_harvest_last_attempt_at: string
          fee_harvest_last_error: string
          fee_harvest_last_success_at: string
          fee_harvest_state: string
          fee_harvest_throttle_until: string
          fee_harvest_total_lamports: number
          fee_treasury_total_lamports: number
          launch_id: string
          lightning_wallet_public_key: string
          token_name: string
          token_symbol: string
          unclaimed_lamports: number
        }[]
      }
      admin_list_launch_codevs: {
        Args: { p_admin_wallet: string; p_launch_id: string }
        Returns: {
          contribution_lamports: number
          joined_at: string
          paid_lamports: number
          pending_lamports: number
          wallet_address: string
        }[]
      }
      admin_list_launches: {
        Args: { p_admin_wallet: string }
        Returns: {
          category: string | null
          claimer_count: number | null
          codev_mode: string
          codev_roster_locked_at: string | null
          codev_sharing_enabled: boolean
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_contributor_total_lamports: number
          fee_harvest_consecutive_empty: number
          fee_harvest_last_attempt_at: string | null
          fee_harvest_last_error: string | null
          fee_harvest_last_success_at: string | null
          fee_harvest_locked_at: string | null
          fee_harvest_state: string
          fee_harvest_throttle_until: string | null
          fee_harvest_total_lamports: number
          fee_harvest_worker_id: string | null
          fee_share_config_key: string | null
          fee_treasury_total_lamports: number
          hook: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_checklist: Json | null
          launch_datetime: string | null
          launch_window: string | null
          lightning_wallet_encrypted_api_key: string | null
          lightning_wallet_encrypted_private_key: string | null
          lightning_wallet_public_key: string | null
          max_contribution_lamports: number | null
          meme_images: string[]
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_refund_owed_lamports: number | null
          processing_fee_tx_signature: string | null
          profile_description: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          referred_by_affiliate_id: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_handle: string | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_list_lightning_wallets: {
        Args: { p_admin_wallet: string }
        Returns: {
          created_at: string
          id: string
          last_used_at: string
          launch_count: number
          notes: string
          pubkey: string
          slot: number
          status: string
          updated_at: string
        }[]
      }
      admin_list_pumpfun_fee_health: {
        Args: { p_admin_wallet: string }
        Returns: {
          category: string | null
          claimer_count: number | null
          codev_mode: string
          codev_roster_locked_at: string | null
          codev_sharing_enabled: boolean
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_contributor_total_lamports: number
          fee_harvest_consecutive_empty: number
          fee_harvest_last_attempt_at: string | null
          fee_harvest_last_error: string | null
          fee_harvest_last_success_at: string | null
          fee_harvest_locked_at: string | null
          fee_harvest_state: string
          fee_harvest_throttle_until: string | null
          fee_harvest_total_lamports: number
          fee_harvest_worker_id: string | null
          fee_share_config_key: string | null
          fee_treasury_total_lamports: number
          hook: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_checklist: Json | null
          launch_datetime: string | null
          launch_window: string | null
          lightning_wallet_encrypted_api_key: string | null
          lightning_wallet_encrypted_private_key: string | null
          lightning_wallet_public_key: string | null
          max_contribution_lamports: number | null
          meme_images: string[]
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_refund_owed_lamports: number | null
          processing_fee_tx_signature: string | null
          profile_description: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          referred_by_affiliate_id: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_handle: string | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_set_affiliate_status: {
        Args: {
          p_admin_wallet: string
          p_affiliate_id: string
          p_status: string
        }
        Returns: {
          created_at: string
          created_by_admin_wallet: string | null
          id: string
          referral_code: string
          status: string
          updated_at: string
          wallet_address: string
        }
        SetofOptions: {
          from: "*"
          to: "affiliates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_app_setting: {
        Args: { p_admin_wallet: string; p_key: string; p_value: string }
        Returns: undefined
      }
      affiliate_dashboard: { Args: { p_wallet: string }; Returns: Json }
      attribute_wallet_to_affiliate: {
        Args: { p_code: string; p_wallet: string }
        Returns: Json
      }
      claim_allocation_for_user: {
        Args: {
          p_allocation_id: string
          p_delivery_wallet?: string
          p_wallet: string
          p_worker_id: string
        }
        Returns: {
          delivery_wallet: string
          id: string
          lamports: number
          launch_id: string
          lightning_wallet_encrypted_private_key: string
          lightning_wallet_public_key: string
          wallet_address: string
        }[]
      }
      claim_executing_launch_for_worker: {
        Args: { p_lock_expiry_seconds?: number; p_worker_id: string }
        Returns: {
          category: string | null
          claimer_count: number | null
          codev_mode: string
          codev_roster_locked_at: string | null
          codev_sharing_enabled: boolean
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_contributor_total_lamports: number
          fee_harvest_consecutive_empty: number
          fee_harvest_last_attempt_at: string | null
          fee_harvest_last_error: string | null
          fee_harvest_last_success_at: string | null
          fee_harvest_locked_at: string | null
          fee_harvest_state: string
          fee_harvest_throttle_until: string | null
          fee_harvest_total_lamports: number
          fee_harvest_worker_id: string | null
          fee_share_config_key: string | null
          fee_treasury_total_lamports: number
          hook: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_checklist: Json | null
          launch_datetime: string | null
          launch_window: string | null
          lightning_wallet_encrypted_api_key: string | null
          lightning_wallet_encrypted_private_key: string | null
          lightning_wallet_public_key: string | null
          max_contribution_lamports: number | null
          meme_images: string[]
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_refund_owed_lamports: number | null
          processing_fee_tx_signature: string | null
          profile_description: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          referred_by_affiliate_id: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_handle: string | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_launch_for_harvest: {
        Args: {
          p_lock_ttl_seconds?: number
          p_min_interval_seconds?: number
          p_worker_id: string
        }
        Returns: {
          category: string | null
          claimer_count: number | null
          codev_mode: string
          codev_roster_locked_at: string | null
          codev_sharing_enabled: boolean
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_contributor_total_lamports: number
          fee_harvest_consecutive_empty: number
          fee_harvest_last_attempt_at: string | null
          fee_harvest_last_error: string | null
          fee_harvest_last_success_at: string | null
          fee_harvest_locked_at: string | null
          fee_harvest_state: string
          fee_harvest_throttle_until: string | null
          fee_harvest_total_lamports: number
          fee_harvest_worker_id: string | null
          fee_share_config_key: string | null
          fee_treasury_total_lamports: number
          hook: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_checklist: Json | null
          launch_datetime: string | null
          launch_window: string | null
          lightning_wallet_encrypted_api_key: string | null
          lightning_wallet_encrypted_private_key: string | null
          lightning_wallet_public_key: string | null
          max_contribution_lamports: number | null
          meme_images: string[]
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_refund_owed_lamports: number | null
          processing_fee_tx_signature: string | null
          profile_description: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          referred_by_affiliate_id: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_handle: string | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_launch_for_worker: {
        Args: {
          p_lock_expiry_seconds?: number
          p_status: string
          p_worker_id: string
        }
        Returns: {
          category: string | null
          claimer_count: number | null
          codev_mode: string
          codev_roster_locked_at: string | null
          codev_sharing_enabled: boolean
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_contributor_total_lamports: number
          fee_harvest_consecutive_empty: number
          fee_harvest_last_attempt_at: string | null
          fee_harvest_last_error: string | null
          fee_harvest_last_success_at: string | null
          fee_harvest_locked_at: string | null
          fee_harvest_state: string
          fee_harvest_throttle_until: string | null
          fee_harvest_total_lamports: number
          fee_harvest_worker_id: string | null
          fee_share_config_key: string | null
          fee_treasury_total_lamports: number
          hook: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_checklist: Json | null
          launch_datetime: string | null
          launch_window: string | null
          lightning_wallet_encrypted_api_key: string | null
          lightning_wallet_encrypted_private_key: string | null
          lightning_wallet_public_key: string | null
          max_contribution_lamports: number | null
          meme_images: string[]
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_refund_owed_lamports: number | null
          processing_fee_tx_signature: string | null
          profile_description: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          referred_by_affiliate_id: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_handle: string | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_local_signing_pumpfun_launches_batch_for_worker: {
        Args: {
          p_limit?: number
          p_lock_expiry_seconds?: number
          p_worker_id: string
        }
        Returns: {
          category: string | null
          claimer_count: number | null
          codev_mode: string
          codev_roster_locked_at: string | null
          codev_sharing_enabled: boolean
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_contributor_total_lamports: number
          fee_harvest_consecutive_empty: number
          fee_harvest_last_attempt_at: string | null
          fee_harvest_last_error: string | null
          fee_harvest_last_success_at: string | null
          fee_harvest_locked_at: string | null
          fee_harvest_state: string
          fee_harvest_throttle_until: string | null
          fee_harvest_total_lamports: number
          fee_harvest_worker_id: string | null
          fee_share_config_key: string | null
          fee_treasury_total_lamports: number
          hook: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_checklist: Json | null
          launch_datetime: string | null
          launch_window: string | null
          lightning_wallet_encrypted_api_key: string | null
          lightning_wallet_encrypted_private_key: string | null
          lightning_wallet_public_key: string | null
          max_contribution_lamports: number | null
          meme_images: string[]
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_refund_owed_lamports: number | null
          processing_fee_tx_signature: string | null
          profile_description: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          referred_by_affiliate_id: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_handle: string | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_pump_keypair_from_pool: {
        Args: { p_launch_id?: string }
        Returns: {
          encrypted_private_key: string
          id: string
          public_key: string
        }[]
      }
      claim_pumpfun_launch_for_worker: {
        Args: { p_lock_expiry_seconds?: number; p_worker_id: string }
        Returns: {
          category: string | null
          claimer_count: number | null
          codev_mode: string
          codev_roster_locked_at: string | null
          codev_sharing_enabled: boolean
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_contributor_total_lamports: number
          fee_harvest_consecutive_empty: number
          fee_harvest_last_attempt_at: string | null
          fee_harvest_last_error: string | null
          fee_harvest_last_success_at: string | null
          fee_harvest_locked_at: string | null
          fee_harvest_state: string
          fee_harvest_throttle_until: string | null
          fee_harvest_total_lamports: number
          fee_harvest_worker_id: string | null
          fee_share_config_key: string | null
          fee_treasury_total_lamports: number
          hook: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_checklist: Json | null
          launch_datetime: string | null
          launch_window: string | null
          lightning_wallet_encrypted_api_key: string | null
          lightning_wallet_encrypted_private_key: string | null
          lightning_wallet_public_key: string | null
          max_contribution_lamports: number | null
          meme_images: string[]
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_refund_owed_lamports: number | null
          processing_fee_tx_signature: string | null
          profile_description: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          referred_by_affiliate_id: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_handle: string | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_pumpfun_launches_batch_for_worker:
        | {
            Args: {
              p_limit?: number
              p_lock_expiry_seconds?: number
              p_worker_id: string
            }
            Returns: {
              category: string | null
              claimer_count: number | null
              codev_mode: string
              codev_roster_locked_at: string | null
              codev_sharing_enabled: boolean
              created_at: string
              created_by_wallet: string
              creator_delivery_wallet: string | null
              description: string | null
              distribution_completed: boolean | null
              distribution_completed_at: string | null
              escrow_wallet_encrypted_private_key: string
              escrow_wallet_public_key: string
              excluded_contributors: number | null
              execution_attempts: number
              execution_error: string | null
              fee_contributor_total_lamports: number
              fee_harvest_consecutive_empty: number
              fee_harvest_last_attempt_at: string | null
              fee_harvest_last_error: string | null
              fee_harvest_last_success_at: string | null
              fee_harvest_locked_at: string | null
              fee_harvest_state: string
              fee_harvest_throttle_until: string | null
              fee_harvest_total_lamports: number
              fee_harvest_worker_id: string | null
              fee_share_config_key: string | null
              fee_treasury_total_lamports: number
              hook: string | null
              id: string
              image_url: string | null
              ipfs_metadata_url: string | null
              is_sponsored: boolean | null
              launch_checklist: Json | null
              launch_datetime: string | null
              launch_window: string | null
              lightning_wallet_encrypted_api_key: string | null
              lightning_wallet_encrypted_private_key: string | null
              lightning_wallet_public_key: string | null
              max_contribution_lamports: number | null
              meme_images: string[]
              min_contribution_lamports: number
              platform: string
              processing_fee_lamports: number
              processing_fee_refund_owed_lamports: number | null
              processing_fee_tx_signature: string | null
              profile_description: string | null
              pumpfun_consecutive_empty_claims: number
              pumpfun_creator_fees_distributed: number | null
              pumpfun_creator_vault_balance_lamports: number | null
              pumpfun_creator_vault_checked_at: string | null
              pumpfun_fees_claimed_total: number | null
              pumpfun_fees_last_claimed_at: string | null
              pumpfun_last_claim_attempt_at: string | null
              pumpfun_last_claim_error: string | null
              pumpfun_launch_signature: string | null
              pumpfun_low_volume_throttle_until: string | null
              pumpfun_mint_keypair_encrypted: string | null
              pumpportal_wallet_pubkey: string | null
              referred_by_affiliate_id: string | null
              sponsor_funding_attempts: number
              sponsor_funding_error: string | null
              sponsor_link_claimed_at: string | null
              sponsor_link_expires_at: string | null
              sponsor_link_token: string | null
              sponsor_recovery_amount_lamports: number | null
              sponsor_recovery_attempts: number
              sponsor_recovery_completed_at: string | null
              sponsor_recovery_error: string | null
              sponsor_recovery_tx_signature: string | null
              sponsored_amount_lamports: number | null
              sponsored_by: string | null
              sponsored_tx_signature: string | null
              status: Database["public"]["Enums"]["launch_status"]
              telegram_url: string | null
              token_mint_address: string | null
              token_name: string
              token_symbol: string
              total_tokens_distributed: number | null
              twitter_handle: string | null
              twitter_url: string | null
              website_url: string | null
              worker_id: string | null
              worker_locked_at: string | null
            }[]
            SetofOptions: {
              from: "*"
              to: "launches"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: {
              p_limit?: number
              p_lock_expiry_seconds?: number
              p_wallet_pubkey?: string
              p_worker_id: string
            }
            Returns: {
              category: string | null
              claimer_count: number | null
              codev_mode: string
              codev_roster_locked_at: string | null
              codev_sharing_enabled: boolean
              created_at: string
              created_by_wallet: string
              creator_delivery_wallet: string | null
              description: string | null
              distribution_completed: boolean | null
              distribution_completed_at: string | null
              escrow_wallet_encrypted_private_key: string
              escrow_wallet_public_key: string
              excluded_contributors: number | null
              execution_attempts: number
              execution_error: string | null
              fee_contributor_total_lamports: number
              fee_harvest_consecutive_empty: number
              fee_harvest_last_attempt_at: string | null
              fee_harvest_last_error: string | null
              fee_harvest_last_success_at: string | null
              fee_harvest_locked_at: string | null
              fee_harvest_state: string
              fee_harvest_throttle_until: string | null
              fee_harvest_total_lamports: number
              fee_harvest_worker_id: string | null
              fee_share_config_key: string | null
              fee_treasury_total_lamports: number
              hook: string | null
              id: string
              image_url: string | null
              ipfs_metadata_url: string | null
              is_sponsored: boolean | null
              launch_checklist: Json | null
              launch_datetime: string | null
              launch_window: string | null
              lightning_wallet_encrypted_api_key: string | null
              lightning_wallet_encrypted_private_key: string | null
              lightning_wallet_public_key: string | null
              max_contribution_lamports: number | null
              meme_images: string[]
              min_contribution_lamports: number
              platform: string
              processing_fee_lamports: number
              processing_fee_refund_owed_lamports: number | null
              processing_fee_tx_signature: string | null
              profile_description: string | null
              pumpfun_consecutive_empty_claims: number
              pumpfun_creator_fees_distributed: number | null
              pumpfun_creator_vault_balance_lamports: number | null
              pumpfun_creator_vault_checked_at: string | null
              pumpfun_fees_claimed_total: number | null
              pumpfun_fees_last_claimed_at: string | null
              pumpfun_last_claim_attempt_at: string | null
              pumpfun_last_claim_error: string | null
              pumpfun_launch_signature: string | null
              pumpfun_low_volume_throttle_until: string | null
              pumpfun_mint_keypair_encrypted: string | null
              pumpportal_wallet_pubkey: string | null
              referred_by_affiliate_id: string | null
              sponsor_funding_attempts: number
              sponsor_funding_error: string | null
              sponsor_link_claimed_at: string | null
              sponsor_link_expires_at: string | null
              sponsor_link_token: string | null
              sponsor_recovery_amount_lamports: number | null
              sponsor_recovery_attempts: number
              sponsor_recovery_completed_at: string | null
              sponsor_recovery_error: string | null
              sponsor_recovery_tx_signature: string | null
              sponsored_amount_lamports: number | null
              sponsored_by: string | null
              sponsored_tx_signature: string | null
              status: Database["public"]["Enums"]["launch_status"]
              telegram_url: string | null
              token_mint_address: string | null
              token_name: string
              token_symbol: string
              total_tokens_distributed: number | null
              twitter_handle: string | null
              twitter_url: string | null
              website_url: string | null
              worker_id: string | null
              worker_locked_at: string | null
            }[]
            SetofOptions: {
              from: "*"
              to: "launches"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      claim_sponsor_funding_for_worker: {
        Args: { p_lock_expiry_seconds?: number; p_worker_id: string }
        Returns: {
          category: string | null
          claimer_count: number | null
          codev_mode: string
          codev_roster_locked_at: string | null
          codev_sharing_enabled: boolean
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_contributor_total_lamports: number
          fee_harvest_consecutive_empty: number
          fee_harvest_last_attempt_at: string | null
          fee_harvest_last_error: string | null
          fee_harvest_last_success_at: string | null
          fee_harvest_locked_at: string | null
          fee_harvest_state: string
          fee_harvest_throttle_until: string | null
          fee_harvest_total_lamports: number
          fee_harvest_worker_id: string | null
          fee_share_config_key: string | null
          fee_treasury_total_lamports: number
          hook: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_checklist: Json | null
          launch_datetime: string | null
          launch_window: string | null
          lightning_wallet_encrypted_api_key: string | null
          lightning_wallet_encrypted_private_key: string | null
          lightning_wallet_public_key: string | null
          max_contribution_lamports: number | null
          meme_images: string[]
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_refund_owed_lamports: number | null
          processing_fee_tx_signature: string | null
          profile_description: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          referred_by_affiliate_id: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_handle: string | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_sponsor_recovery_for_worker: {
        Args: { p_lock_expiry_seconds?: number; p_worker_id: string }
        Returns: {
          category: string | null
          claimer_count: number | null
          codev_mode: string
          codev_roster_locked_at: string | null
          codev_sharing_enabled: boolean
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_contributor_total_lamports: number
          fee_harvest_consecutive_empty: number
          fee_harvest_last_attempt_at: string | null
          fee_harvest_last_error: string | null
          fee_harvest_last_success_at: string | null
          fee_harvest_locked_at: string | null
          fee_harvest_state: string
          fee_harvest_throttle_until: string | null
          fee_harvest_total_lamports: number
          fee_harvest_worker_id: string | null
          fee_share_config_key: string | null
          fee_treasury_total_lamports: number
          hook: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_checklist: Json | null
          launch_datetime: string | null
          launch_window: string | null
          lightning_wallet_encrypted_api_key: string | null
          lightning_wallet_encrypted_private_key: string | null
          lightning_wallet_public_key: string | null
          max_contribution_lamports: number | null
          meme_images: string[]
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_refund_owed_lamports: number | null
          processing_fee_tx_signature: string | null
          profile_description: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          referred_by_affiliate_id: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_handle: string | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_sweep_recovery_launch_for_worker: {
        Args: { p_lock_expiry_seconds?: number; p_worker_id: string }
        Returns: {
          category: string | null
          claimer_count: number | null
          codev_mode: string
          codev_roster_locked_at: string | null
          codev_sharing_enabled: boolean
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_contributor_total_lamports: number
          fee_harvest_consecutive_empty: number
          fee_harvest_last_attempt_at: string | null
          fee_harvest_last_error: string | null
          fee_harvest_last_success_at: string | null
          fee_harvest_locked_at: string | null
          fee_harvest_state: string
          fee_harvest_throttle_until: string | null
          fee_harvest_total_lamports: number
          fee_harvest_worker_id: string | null
          fee_share_config_key: string | null
          fee_treasury_total_lamports: number
          hook: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_checklist: Json | null
          launch_datetime: string | null
          launch_window: string | null
          lightning_wallet_encrypted_api_key: string | null
          lightning_wallet_encrypted_private_key: string | null
          lightning_wallet_public_key: string | null
          max_contribution_lamports: number | null
          meme_images: string[]
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_refund_owed_lamports: number | null
          processing_fee_tx_signature: string | null
          profile_description: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          referred_by_affiliate_id: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_handle: string | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      codev_dashboard: { Args: { p_wallet: string }; Returns: Json }
      complete_allocation_claim: {
        Args: { p_allocation_id: string; p_tx_signature: string }
        Returns: undefined
      }
      enable_codev_sharing: {
        Args: { p_launch_id: string; p_mode: string; p_wallet: string }
        Returns: undefined
      }
      fail_allocation_claim: {
        Args: { p_allocation_id: string; p_error: string }
        Returns: undefined
      }
      force_fee_harvest_retry: {
        Args: { p_launch_id: string }
        Returns: undefined
      }
      force_pumpfun_fee_claim_retry: {
        Args: { p_launch_id: string }
        Returns: undefined
      }
      get_launch_codev_info: { Args: { p_launch_id: string }; Returns: Json }
      get_launch_fee_split: {
        Args: { p_launch_id: string }
        Returns: {
          affiliate_bps: number
          affiliate_id: string
          affiliate_wallet: string
          codev_allocations: Json
          codev_bps: number
          creator_bps: number
          creator_wallet: string
          launch_id: string
          treasury_bps: number
        }[]
      }
      get_launch_platform_status: {
        Args: never
        Returns: {
          bags_enabled: boolean
          bags_updated_at: string
          pumpfun_enabled: boolean
          pumpfun_updated_at: string
        }[]
      }
      get_launch_public: {
        Args: { p_id: string }
        Returns: {
          category: string | null
          claimer_count: number | null
          created_at: string | null
          created_by_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_public_key: string | null
          fee_share_config_key: string | null
          hook: string | null
          id: string | null
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_checklist: Json | null
          launch_datetime: string | null
          launch_window: string | null
          max_contribution_lamports: number | null
          meme_images: string[] | null
          min_contribution_lamports: number | null
          platform: string | null
          profile_description: string | null
          pumpfun_launch_signature: string | null
          sponsored_amount_lamports: number | null
          status: Database["public"]["Enums"]["launch_status"] | null
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string | null
          token_symbol: string | null
          total_tokens_distributed: number | null
          twitter_handle: string | null
          twitter_url: string | null
          website_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "launches_public"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_my_affiliate: {
        Args: { p_wallet: string }
        Returns: {
          created_at: string
          id: string
          referral_code: string
          status: string
          wallet_address: string
        }[]
      }
      get_sponsor_slot_by_token: {
        Args: { p_token: string }
        Returns: {
          id: string
          launch_datetime: string
          sponsor_link_expires_at: string
          sponsored_amount_lamports: number
          status: string
          token_name: string
          token_symbol: string
        }[]
      }
      get_wallet_affiliate: { Args: { p_wallet: string }; Returns: string }
      increment_pumpfun_fees_claimed: {
        Args: { amount: number; launch_id: string }
        Returns: undefined
      }
      is_admin_wallet: { Args: { p_wallet: string }; Returns: boolean }
      list_claimable_fees: {
        Args: { p_wallet: string }
        Returns: {
          basis_points: number
          claim_state: string
          claim_tx_signature: string
          claimed_at: string
          created_at: string
          cycle_id: string
          id: string
          lamports: number
          launch_id: string
          token_mint_address: string
          token_name: string
          token_symbol: string
          wallet_address: string
        }[]
      }
      list_my_contributions: {
        Args: { p_wallet: string }
        Returns: {
          amount_lamports: number
          basis_points: number
          contributed_at: string
          distribution_error: string
          distribution_tx_signature: string
          id: string
          is_fee_claimer: boolean
          launches: Json
          refund_tx_signature: string
          token_amount: number
          token_delivery_wallet: string
          tokens_distributed: boolean
          tx_signature: string
          wallet_address: string
        }[]
      }
      lock_codev_roster: { Args: { p_launch_id: string }; Returns: undefined }
      mark_pumpfun_fee_claim_attempt: {
        Args: { p_launch_id: string }
        Returns: undefined
      }
      record_affiliate_earning: {
        Args: {
          p_amount_lamports: number
          p_launch_id: string
          p_status?: string
          p_tx_signature: string
        }
        Returns: string
      }
      record_codev_batch: {
        Args: {
          p_cycle_id: string
          p_launch_id: string
          p_payouts: Json
          p_tx_signature: string
        }
        Returns: undefined
      }
      record_harvest_cycle: {
        Args: {
          p_allocations: Json
          p_claim_tx_signature: string
          p_contributor_lamports: number
          p_escrow_balance_after: number
          p_escrow_balance_before: number
          p_gross_lamports: number
          p_launch_id: string
          p_notes?: string
          p_treasury_lamports: number
          p_treasury_tx_signature: string
          p_vault_balance_before: number
        }
        Returns: string
      }
      record_harvest_empty: {
        Args: { p_launch_id: string }
        Returns: undefined
      }
      record_harvest_failure: {
        Args: { p_error: string; p_launch_id: string }
        Returns: undefined
      }
      record_pumpfun_creator_vault_balance: {
        Args: { p_balance_lamports: number; p_launch_ids: string[] }
        Returns: undefined
      }
      record_pumpfun_empty_claim: {
        Args: { p_launch_id: string }
        Returns: undefined
      }
      record_pumpfun_fee_claim_failure: {
        Args: { p_error: string; p_launch_id: string }
        Returns: undefined
      }
      record_pumpfun_fee_treasury_sweep: {
        Args: {
          p_amount_lamports: number
          p_launch_id: string
          p_notes?: string
          p_source_wallet: string
          p_treasury_wallet: string
          p_tx_signature: string
        }
        Returns: string
      }
      record_pumpfun_wallet_starved: {
        Args: { p_error: string; p_launch_id: string }
        Returns: undefined
      }
      release_custodial_lock: { Args: { p_key: string }; Returns: boolean }
      release_custodial_row_lock: {
        Args: { p_key: string; p_worker: string }
        Returns: boolean
      }
      release_harvest_lock: {
        Args: { p_launch_id: string }
        Returns: undefined
      }
      reset_all_pumpfun_fee_throttles: { Args: never; Returns: number }
      resolve_referral_code: {
        Args: { p_code: string }
        Returns: {
          affiliate_id: string
          status: string
        }[]
      }
      set_app_setting: {
        Args: { p_key: string; p_value: string }
        Returns: undefined
      }
      set_launch_platform_status: {
        Args: { p_admin_wallet: string; p_enabled: boolean; p_platform: string }
        Returns: {
          bags_enabled: boolean
          bags_updated_at: string
          pumpfun_enabled: boolean
          pumpfun_updated_at: string
        }[]
      }
      try_acquire_custodial_lock: { Args: { p_key: string }; Returns: boolean }
      try_acquire_custodial_row_lock: {
        Args: { p_key: string; p_ttl_seconds?: number; p_worker: string }
        Returns: boolean
      }
      upsert_launch_codev: {
        Args: {
          p_contribution_lamports: number
          p_launch_id: string
          p_wallet_address: string
        }
        Returns: undefined
      }
    }
    Enums: {
      launch_status:
        | "scheduled"
        | "executing"
        | "launched"
        | "execution_failed"
        | "cancelled"
        | "sponsor_pending"
        | "sweep_recovery"
        | "sponsor_pending_funding"
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
    Enums: {
      launch_status: [
        "scheduled",
        "executing",
        "launched",
        "execution_failed",
        "cancelled",
        "sponsor_pending",
        "sweep_recovery",
        "sponsor_pending_funding",
      ],
    },
  },
} as const
