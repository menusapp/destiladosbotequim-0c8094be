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
      app_versions: {
        Row: {
          build_url: string | null
          created_at: string | null
          download_url_linux: string | null
          download_url_mac: string | null
          download_url_windows: string | null
          id: string
          is_current: boolean | null
          release_notes: string | null
          version: string
        }
        Insert: {
          build_url?: string | null
          created_at?: string | null
          download_url_linux?: string | null
          download_url_mac?: string | null
          download_url_windows?: string | null
          id?: string
          is_current?: boolean | null
          release_notes?: string | null
          version: string
        }
        Update: {
          build_url?: string | null
          created_at?: string | null
          download_url_linux?: string | null
          download_url_mac?: string | null
          download_url_windows?: string | null
          id?: string
          is_current?: boolean | null
          release_notes?: string | null
          version?: string
        }
        Relationships: []
      }
      bills: {
        Row: {
          change_amount: number | null
          comanda_id: string | null
          created_at: string | null
          id: string
          paid_at: string | null
          payment_method: string | null
          payment_splits: Json | null
          service_fee: number
          status: string | null
          subtotal: number
          table_id: string
          total_amount: number
        }
        Insert: {
          change_amount?: number | null
          comanda_id?: string | null
          created_at?: string | null
          id?: string
          paid_at?: string | null
          payment_method?: string | null
          payment_splits?: Json | null
          service_fee: number
          status?: string | null
          subtotal: number
          table_id: string
          total_amount: number
        }
        Update: {
          change_amount?: number | null
          comanda_id?: string | null
          created_at?: string | null
          id?: string
          paid_at?: string | null
          payment_method?: string | null
          payment_splits?: Json | null
          service_fee?: number
          status?: string | null
          subtotal?: number
          table_id?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "bills_comanda_id_fkey"
            columns: ["comanda_id"]
            isOneToOne: false
            referencedRelation: "comandas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      business_hours: {
        Row: {
          close_time: string | null
          created_at: string | null
          day_of_week: number
          id: string
          is_open: boolean | null
          open_time: string | null
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          close_time?: string | null
          created_at?: string | null
          day_of_week: number
          id?: string
          is_open?: boolean | null
          open_time?: string | null
          restaurant_id: string
          updated_at?: string | null
        }
        Update: {
          close_time?: string | null
          created_at?: string | null
          day_of_week?: number
          id?: string
          is_open?: boolean | null
          open_time?: string | null
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_hours_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      card_fees: {
        Row: {
          card_brand: string
          created_at: string | null
          fee_percentage: number
          id: string
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          card_brand: string
          created_at?: string | null
          fee_percentage?: number
          id?: string
          restaurant_id: string
          updated_at?: string | null
        }
        Update: {
          card_brand?: string
          created_at?: string | null
          fee_percentage?: number
          id?: string
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "card_fees_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      card_fees_config: {
        Row: {
          created_at: string | null
          credit_fee: number
          debit_fee: number
          id: string
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          credit_fee?: number
          debit_fee?: number
          id?: string
          restaurant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          credit_fee?: number
          debit_fee?: number
          id?: string
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "card_fees_config_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount: number
          bill_id: string | null
          cash_session_id: string
          category: string | null
          created_at: string | null
          created_by: string
          description: string
          id: string
          movement_type: string
          order_id: string | null
          payment_method: string | null
          restaurant_id: string
        }
        Insert: {
          amount: number
          bill_id?: string | null
          cash_session_id: string
          category?: string | null
          created_at?: string | null
          created_by: string
          description: string
          id?: string
          movement_type: string
          order_id?: string | null
          payment_method?: string | null
          restaurant_id: string
        }
        Update: {
          amount?: number
          bill_id?: string | null
          cash_session_id?: string
          category?: string | null
          created_at?: string | null
          created_by?: string
          description?: string
          id?: string
          movement_type?: string
          order_id?: string | null
          payment_method?: string | null
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_register_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_register_sessions: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closing_balance: number | null
          created_at: string | null
          difference: number | null
          expected_balance: number | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string
          opening_balance: number
          restaurant_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closing_balance?: number | null
          created_at?: string | null
          difference?: number | null
          expected_balance?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by: string
          opening_balance?: number
          restaurant_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closing_balance?: number | null
          created_at?: string | null
          difference?: number | null
          expected_balance?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string
          opening_balance?: number
          restaurant_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_register_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string | null
          display_order: number | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          restaurant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ceo_users: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          password_hash: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          password_hash: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          password_hash?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      comandas: {
        Row: {
          closed_at: string | null
          created_at: string | null
          customer_cpf: string
          customer_name: string
          id: string
          restaurant_id: string
          status: string | null
          table_id: string
          updated_at: string | null
        }
        Insert: {
          closed_at?: string | null
          created_at?: string | null
          customer_cpf: string
          customer_name: string
          id?: string
          restaurant_id: string
          status?: string | null
          table_id: string
          updated_at?: string | null
        }
        Update: {
          closed_at?: string | null
          created_at?: string | null
          customer_cpf?: string
          customer_name?: string
          id?: string
          restaurant_id?: string
          status?: string | null
          table_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comandas_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comandas_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      counter_order_item_extras: {
        Row: {
          counter_order_item_id: string
          created_at: string
          id: string
          price_at_order: number
          product_extra_id: string | null
        }
        Insert: {
          counter_order_item_id: string
          created_at?: string
          id?: string
          price_at_order: number
          product_extra_id?: string | null
        }
        Update: {
          counter_order_item_id?: string
          created_at?: string
          id?: string
          price_at_order?: number
          product_extra_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "counter_order_item_extras_counter_order_item_id_fkey"
            columns: ["counter_order_item_id"]
            isOneToOne: false
            referencedRelation: "counter_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counter_order_item_extras_product_extra_id_fkey"
            columns: ["product_extra_id"]
            isOneToOne: false
            referencedRelation: "product_extras"
            referencedColumns: ["id"]
          },
        ]
      }
      counter_order_items: {
        Row: {
          cost_snapshot: number | null
          counter_order_id: string
          created_at: string
          id: string
          notes: string | null
          price_at_order: number
          product_id: string | null
          quantity: number
        }
        Insert: {
          cost_snapshot?: number | null
          counter_order_id: string
          created_at?: string
          id?: string
          notes?: string | null
          price_at_order: number
          product_id?: string | null
          quantity?: number
        }
        Update: {
          cost_snapshot?: number | null
          counter_order_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          price_at_order?: number
          product_id?: string | null
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "counter_order_items_counter_order_id_fkey"
            columns: ["counter_order_id"]
            isOneToOne: false
            referencedRelation: "counter_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counter_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      counter_orders: {
        Row: {
          created_at: string
          created_by: string
          customer_cpf: string | null
          customer_name: string
          fee_amount: number | null
          fee_type: string | null
          fee_value: number | null
          finalized_at: string | null
          id: string
          notes: string | null
          payment_method: string | null
          restaurant_id: string
          status: string
          subtotal: number
          table_id: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          customer_cpf?: string | null
          customer_name: string
          fee_amount?: number | null
          fee_type?: string | null
          fee_value?: number | null
          finalized_at?: string | null
          id?: string
          notes?: string | null
          payment_method?: string | null
          restaurant_id: string
          status?: string
          subtotal?: number
          table_id: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          customer_cpf?: string | null
          customer_name?: string
          fee_amount?: number | null
          fee_type?: string | null
          fee_value?: number | null
          finalized_at?: string | null
          id?: string
          notes?: string | null
          payment_method?: string | null
          restaurant_id?: string
          status?: string
          subtotal?: number
          table_id?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "counter_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counter_orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          code: string
          coupon_type: string | null
          created_at: string | null
          discount_type: string
          discount_value: number
          id: string
          is_active: boolean | null
          max_discount: number | null
          min_order_value: number | null
          restaurant_id: string
          target_extra_id: string | null
          target_product_extra_id: string | null
          target_product_id: string | null
          updated_at: string | null
          usage_limit: number | null
          usage_limit_per_user: number | null
          used_count: number | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          code: string
          coupon_type?: string | null
          created_at?: string | null
          discount_type: string
          discount_value: number
          id?: string
          is_active?: boolean | null
          max_discount?: number | null
          min_order_value?: number | null
          restaurant_id: string
          target_extra_id?: string | null
          target_product_extra_id?: string | null
          target_product_id?: string | null
          updated_at?: string | null
          usage_limit?: number | null
          usage_limit_per_user?: number | null
          used_count?: number | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          code?: string
          coupon_type?: string | null
          created_at?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          is_active?: boolean | null
          max_discount?: number | null
          min_order_value?: number | null
          restaurant_id?: string
          target_extra_id?: string | null
          target_product_extra_id?: string | null
          target_product_id?: string | null
          updated_at?: string | null
          usage_limit?: number | null
          usage_limit_per_user?: number | null
          used_count?: number | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupons_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_target_extra_id_fkey"
            columns: ["target_extra_id"]
            isOneToOne: false
            referencedRelation: "extra_category_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_target_product_extra_id_fkey"
            columns: ["target_product_extra_id"]
            isOneToOne: false
            referencedRelation: "product_extras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_target_product_id_fkey"
            columns: ["target_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          city: string
          complement: string | null
          created_at: string | null
          customer_cpf: string
          customer_name: string
          customer_phone: string
          id: string
          is_default: boolean | null
          neighborhood: string
          number: string
          restaurant_id: string | null
          state: string
          street: string
          updated_at: string | null
          zip_code: string
        }
        Insert: {
          city: string
          complement?: string | null
          created_at?: string | null
          customer_cpf: string
          customer_name: string
          customer_phone: string
          id?: string
          is_default?: boolean | null
          neighborhood: string
          number: string
          restaurant_id?: string | null
          state: string
          street: string
          updated_at?: string | null
          zip_code: string
        }
        Update: {
          city?: string
          complement?: string | null
          created_at?: string | null
          customer_cpf?: string
          customer_name?: string
          customer_phone?: string
          id?: string
          is_default?: boolean | null
          neighborhood?: string
          number?: string
          restaurant_id?: string | null
          state?: string
          street?: string
          updated_at?: string | null
          zip_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_cards: {
        Row: {
          card_id: string
          created_at: string | null
          customer_cpf: string
          customer_phone: string
          expiration_month: number | null
          expiration_year: number | null
          first_six_digits: string | null
          id: string
          last_four_digits: string
          mp_customer_id: string
          payment_method_id: string
          restaurant_id: string
        }
        Insert: {
          card_id: string
          created_at?: string | null
          customer_cpf: string
          customer_phone: string
          expiration_month?: number | null
          expiration_year?: number | null
          first_six_digits?: string | null
          id?: string
          last_four_digits: string
          mp_customer_id: string
          payment_method_id: string
          restaurant_id: string
        }
        Update: {
          card_id?: string
          created_at?: string | null
          customer_cpf?: string
          customer_phone?: string
          expiration_month?: number | null
          expiration_year?: number | null
          first_six_digits?: string | null
          id?: string
          last_four_digits?: string
          mp_customer_id?: string
          payment_method_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_cards_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_loyalty_progress: {
        Row: {
          created_at: string | null
          customer_cpf: string
          id: string
          last_reward_trigger: number | null
          program_id: string
          purchase_count: number | null
          restaurant_id: string
          total_spent: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_cpf: string
          id?: string
          last_reward_trigger?: number | null
          program_id: string
          purchase_count?: number | null
          restaurant_id: string
          total_spent?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_cpf?: string
          id?: string
          last_reward_trigger?: number | null
          program_id?: string
          purchase_count?: number | null
          restaurant_id?: string
          total_spent?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_loyalty_progress_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "loyalty_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_loyalty_progress_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_sessions: {
        Row: {
          abandoned_at: string | null
          cart_items: Json | null
          cart_value: number | null
          checkout_step: string | null
          coupon_code: string | null
          created_at: string | null
          delivery_address: string | null
          delivery_type: string | null
          id: string
          last_activity: string | null
          name: string | null
          phone: string | null
          restaurant_id: string
          session_token: string
          status: string | null
        }
        Insert: {
          abandoned_at?: string | null
          cart_items?: Json | null
          cart_value?: number | null
          checkout_step?: string | null
          coupon_code?: string | null
          created_at?: string | null
          delivery_address?: string | null
          delivery_type?: string | null
          id?: string
          last_activity?: string | null
          name?: string | null
          phone?: string | null
          restaurant_id: string
          session_token: string
          status?: string | null
        }
        Update: {
          abandoned_at?: string | null
          cart_items?: Json | null
          cart_value?: number | null
          checkout_step?: string | null
          coupon_code?: string | null
          created_at?: string | null
          delivery_address?: string | null
          delivery_type?: string | null
          id?: string
          last_activity?: string | null
          name?: string | null
          phone?: string | null
          restaurant_id?: string
          session_token?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          birth_date: string | null
          cpf: string
          created_at: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          birth_date?: string | null
          cpf: string
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          restaurant_id: string
          updated_at?: string | null
        }
        Update: {
          birth_date?: string | null
          cpf?: string
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_config: {
        Row: {
          created_at: string | null
          delivery_fee: number | null
          estimated_time_minutes: number | null
          id: string
          min_order_value: number | null
          restaurant_id: string
          store_address: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          delivery_fee?: number | null
          estimated_time_minutes?: number | null
          id?: string
          min_order_value?: number | null
          restaurant_id: string
          store_address?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          delivery_fee?: number | null
          estimated_time_minutes?: number | null
          id?: string
          min_order_value?: number | null
          restaurant_id?: string
          store_address?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_config_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_zones: {
        Row: {
          center_lat: number | null
          center_lng: number | null
          created_at: string | null
          delivery_fee: number | null
          estimated_time_minutes: number | null
          id: string
          is_active: boolean | null
          min_order_value: number | null
          neighborhoods: string[] | null
          radius_km: number | null
          restaurant_id: string
          updated_at: string | null
          zip_codes: string[] | null
          zone_name: string
          zone_type: string | null
        }
        Insert: {
          center_lat?: number | null
          center_lng?: number | null
          created_at?: string | null
          delivery_fee?: number | null
          estimated_time_minutes?: number | null
          id?: string
          is_active?: boolean | null
          min_order_value?: number | null
          neighborhoods?: string[] | null
          radius_km?: number | null
          restaurant_id: string
          updated_at?: string | null
          zip_codes?: string[] | null
          zone_name: string
          zone_type?: string | null
        }
        Update: {
          center_lat?: number | null
          center_lng?: number | null
          created_at?: string | null
          delivery_fee?: number | null
          estimated_time_minutes?: number | null
          id?: string
          is_active?: boolean | null
          min_order_value?: number | null
          neighborhoods?: string[] | null
          radius_km?: number | null
          restaurant_id?: string
          updated_at?: string | null
          zip_codes?: string[] | null
          zone_name?: string
          zone_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_zones_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      deliverydireto_config: {
        Row: {
          access_token: string | null
          client_id: string | null
          created_at: string | null
          enabled: boolean | null
          id: string
          last_sync_at: string | null
          password_hash: string | null
          refresh_token: string | null
          restaurant_id: string
          store_id: string | null
          token_expires_at: string | null
          updated_at: string | null
          username: string | null
          webhook_url: string | null
        }
        Insert: {
          access_token?: string | null
          client_id?: string | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          last_sync_at?: string | null
          password_hash?: string | null
          refresh_token?: string | null
          restaurant_id: string
          store_id?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          username?: string | null
          webhook_url?: string | null
        }
        Update: {
          access_token?: string | null
          client_id?: string | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          last_sync_at?: string | null
          password_hash?: string | null
          refresh_token?: string | null
          restaurant_id?: string
          store_id?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          username?: string | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliverydireto_config_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_credits: {
        Row: {
          amount: number
          created_at: string | null
          created_by: string | null
          due_date: string | null
          employee_id: string | null
          employee_name: string
          id: string
          notes: string | null
          order_id: string | null
          paid_amount: number | null
          paid_at: string | null
          paid_method: string | null
          restaurant_id: string
          status: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          created_by?: string | null
          due_date?: string | null
          employee_id?: string | null
          employee_name: string
          id?: string
          notes?: string | null
          order_id?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          paid_method?: string | null
          restaurant_id: string
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          created_by?: string | null
          due_date?: string | null
          employee_id?: string | null
          employee_name?: string
          id?: string
          notes?: string | null
          order_id?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          paid_method?: string | null
          restaurant_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_credits_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_credits_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      extra_categories: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          is_required: boolean
          max_quantity: number
          min_quantity: number
          name: string
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_required?: boolean
          max_quantity?: number
          min_quantity?: number
          name: string
          restaurant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_required?: boolean
          max_quantity?: number
          min_quantity?: number
          name?: string
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      extra_category_item_ingredients: {
        Row: {
          category_item_id: string
          created_at: string | null
          id: string
          quantity: number
          stock_item_id: string
        }
        Insert: {
          category_item_id: string
          created_at?: string | null
          id?: string
          quantity?: number
          stock_item_id: string
        }
        Update: {
          category_item_id?: string
          created_at?: string | null
          id?: string
          quantity?: number
          stock_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extra_category_item_ingredients_category_item_id_fkey"
            columns: ["category_item_id"]
            isOneToOne: false
            referencedRelation: "extra_category_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extra_category_item_ingredients_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      extra_category_items: {
        Row: {
          category_id: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          pdv_code: string | null
          price: number
          updated_at: string | null
        }
        Insert: {
          category_id: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          pdv_code?: string | null
          price?: number
          updated_at?: string | null
        }
        Update: {
          category_id?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          pdv_code?: string | null
          price?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "extra_category_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "extra_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_configs: {
        Row: {
          bairro: string | null
          cep: string | null
          certificate_file_path: string | null
          certificate_password: string | null
          cnpj: string | null
          complemento: string | null
          created_at: string | null
          csc_code: string | null
          csc_id: string | null
          email: string | null
          id: string
          inscricao_estadual: string | null
          inscricao_municipal: string | null
          logradouro: string | null
          municipio_codigo: string | null
          municipio_nome: string | null
          nfce_numero: number | null
          nfce_serie: number | null
          nome_fantasia: string | null
          numero: string | null
          nuvem_fiscal_status: string | null
          razao_social: string | null
          restaurant_id: string
          telefone: string | null
          uf: string | null
          updated_at: string | null
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          certificate_file_path?: string | null
          certificate_password?: string | null
          cnpj?: string | null
          complemento?: string | null
          created_at?: string | null
          csc_code?: string | null
          csc_id?: string | null
          email?: string | null
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          logradouro?: string | null
          municipio_codigo?: string | null
          municipio_nome?: string | null
          nfce_numero?: number | null
          nfce_serie?: number | null
          nome_fantasia?: string | null
          numero?: string | null
          nuvem_fiscal_status?: string | null
          razao_social?: string | null
          restaurant_id: string
          telefone?: string | null
          uf?: string | null
          updated_at?: string | null
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          certificate_file_path?: string | null
          certificate_password?: string | null
          cnpj?: string | null
          complemento?: string | null
          created_at?: string | null
          csc_code?: string | null
          csc_id?: string | null
          email?: string | null
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          logradouro?: string | null
          municipio_codigo?: string | null
          municipio_nome?: string | null
          nfce_numero?: number | null
          nfce_serie?: number | null
          nome_fantasia?: string | null
          numero?: string | null
          nuvem_fiscal_status?: string | null
          razao_social?: string | null
          restaurant_id?: string
          telefone?: string | null
          uf?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_configs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_costs: {
        Row: {
          amount: number
          created_at: string | null
          description: string | null
          id: string
          name: string
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          amount?: number
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          restaurant_id: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixed_costs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ifood_config: {
        Row: {
          access_token: string | null
          authorization_code_verifier: string | null
          created_at: string | null
          enabled: boolean | null
          homologation_mode: boolean
          id: string
          last_polling_at: string | null
          merchant_id: string | null
          refresh_token: string | null
          restaurant_id: string
          token_expires_at: string | null
          updated_at: string | null
        }
        Insert: {
          access_token?: string | null
          authorization_code_verifier?: string | null
          created_at?: string | null
          enabled?: boolean | null
          homologation_mode?: boolean
          id?: string
          last_polling_at?: string | null
          merchant_id?: string | null
          refresh_token?: string | null
          restaurant_id: string
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string | null
          authorization_code_verifier?: string | null
          created_at?: string | null
          enabled?: boolean | null
          homologation_mode?: boolean
          id?: string
          last_polling_at?: string | null
          merchant_id?: string | null
          refresh_token?: string | null
          restaurant_id?: string
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ifood_config_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      kiosk_config: {
        Row: {
          coupons_enabled: boolean
          created_at: string | null
          enabled: boolean
          id: string
          inactivity_timeout_seconds: number
          loyalty_enabled: boolean
          order_delivery: boolean
          order_dine_in: boolean
          order_pickup: boolean
          order_takeaway: boolean
          payment_card: boolean
          payment_cash: boolean
          payment_online: boolean
          payment_pix: boolean
          promotions_enabled: boolean
          require_cpf: boolean
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          coupons_enabled?: boolean
          created_at?: string | null
          enabled?: boolean
          id?: string
          inactivity_timeout_seconds?: number
          loyalty_enabled?: boolean
          order_delivery?: boolean
          order_dine_in?: boolean
          order_pickup?: boolean
          order_takeaway?: boolean
          payment_card?: boolean
          payment_cash?: boolean
          payment_online?: boolean
          payment_pix?: boolean
          promotions_enabled?: boolean
          require_cpf?: boolean
          restaurant_id: string
          updated_at?: string | null
        }
        Update: {
          coupons_enabled?: boolean
          created_at?: string | null
          enabled?: boolean
          id?: string
          inactivity_timeout_seconds?: number
          loyalty_enabled?: boolean
          order_delivery?: boolean
          order_dine_in?: boolean
          order_pickup?: boolean
          order_takeaway?: boolean
          payment_card?: boolean
          payment_cash?: boolean
          payment_online?: boolean
          payment_pix?: boolean
          promotions_enabled?: boolean
          require_cpf?: boolean
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      labor_costs: {
        Row: {
          created_at: string | null
          employee_name: string
          id: string
          restaurant_id: string
          role: string | null
          salary: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          employee_name: string
          id?: string
          restaurant_id: string
          role?: string | null
          salary?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          employee_name?: string
          id?: string
          restaurant_id?: string
          role?: string | null
          salary?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "labor_costs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_points: {
        Row: {
          created_at: string | null
          customer_cpf: string
          id: string
          last_updated: string | null
          points_balance: number | null
          restaurant_id: string
          total_earned: number | null
          total_redeemed: number | null
        }
        Insert: {
          created_at?: string | null
          customer_cpf: string
          id?: string
          last_updated?: string | null
          points_balance?: number | null
          restaurant_id: string
          total_earned?: number | null
          total_redeemed?: number | null
        }
        Update: {
          created_at?: string | null
          customer_cpf?: string
          id?: string
          last_updated?: string | null
          points_balance?: number | null
          restaurant_id?: string
          total_earned?: number | null
          total_redeemed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_points_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_program_rewards: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          program_id: string
          reward_extra_id: string | null
          reward_product_id: string | null
          reward_type: string
          reward_value: number | null
          trigger_value: number
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          program_id: string
          reward_extra_id?: string | null
          reward_product_id?: string | null
          reward_type: string
          reward_value?: number | null
          trigger_value: number
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          program_id?: string
          reward_extra_id?: string | null
          reward_product_id?: string | null
          reward_type?: string
          reward_value?: number | null
          trigger_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_program_rewards_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "loyalty_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_program_rewards_reward_extra_id_fkey"
            columns: ["reward_extra_id"]
            isOneToOne: false
            referencedRelation: "product_extras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_program_rewards_reward_product_id_fkey"
            columns: ["reward_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_programs: {
        Row: {
          activated_at: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          restaurant_id: string
          type: string
          updated_at: string | null
        }
        Insert: {
          activated_at?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          restaurant_id: string
          type: string
          updated_at?: string | null
        }
        Update: {
          activated_at?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          restaurant_id?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_programs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_reward_redemptions: {
        Row: {
          created_at: string | null
          customer_cpf: string
          id: string
          order_id: string | null
          program_id: string
          redeemed_at: string | null
          restaurant_id: string
          reward_id: string
          trigger_value: number
        }
        Insert: {
          created_at?: string | null
          customer_cpf: string
          id?: string
          order_id?: string | null
          program_id: string
          redeemed_at?: string | null
          restaurant_id: string
          reward_id: string
          trigger_value: number
        }
        Update: {
          created_at?: string | null
          customer_cpf?: string
          id?: string
          order_id?: string | null
          program_id?: string
          redeemed_at?: string | null
          restaurant_id?: string
          reward_id?: string
          trigger_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_reward_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_reward_redemptions_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "loyalty_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_reward_redemptions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_reward_redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "loyalty_program_rewards"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_transactions: {
        Row: {
          created_at: string | null
          customer_cpf: string
          id: string
          order_id: string | null
          points: number
          restaurant_id: string
          type: string
        }
        Insert: {
          created_at?: string | null
          customer_cpf: string
          id?: string
          order_id?: string | null
          points: number
          restaurant_id: string
          type: string
        }
        Update: {
          created_at?: string | null
          customer_cpf?: string
          id?: string
          order_id?: string | null
          points?: number
          restaurant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaign_rules: {
        Row: {
          campaign_id: string
          coupon_id: string | null
          created_at: string | null
          delay_unit: string
          delay_value: number
          discount_target_category_id: string | null
          discount_target_product_id: string | null
          discount_target_type: string | null
          discount_type: string | null
          discount_validity_days: number | null
          discount_value: number | null
          id: string
          message_template: string
          order_type_filter: string | null
          trigger_category_id: string | null
          trigger_product_id: string | null
          trigger_type: string
        }
        Insert: {
          campaign_id: string
          coupon_id?: string | null
          created_at?: string | null
          delay_unit?: string
          delay_value?: number
          discount_target_category_id?: string | null
          discount_target_product_id?: string | null
          discount_target_type?: string | null
          discount_type?: string | null
          discount_validity_days?: number | null
          discount_value?: number | null
          id?: string
          message_template: string
          order_type_filter?: string | null
          trigger_category_id?: string | null
          trigger_product_id?: string | null
          trigger_type: string
        }
        Update: {
          campaign_id?: string
          coupon_id?: string | null
          created_at?: string | null
          delay_unit?: string
          delay_value?: number
          discount_target_category_id?: string | null
          discount_target_product_id?: string | null
          discount_target_type?: string | null
          discount_type?: string | null
          discount_validity_days?: number | null
          discount_value?: number | null
          id?: string
          message_template?: string
          order_type_filter?: string | null
          trigger_category_id?: string | null
          trigger_product_id?: string | null
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaign_rules_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaign_rules_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaign_rules_discount_target_category_id_fkey"
            columns: ["discount_target_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaign_rules_discount_target_product_id_fkey"
            columns: ["discount_target_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaign_rules_trigger_category_id_fkey"
            columns: ["trigger_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaign_rules_trigger_product_id_fkey"
            columns: ["trigger_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          restaurant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaigns_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_scheduled_messages: {
        Row: {
          campaign_id: string | null
          coupon_code: string | null
          created_at: string | null
          customer_cpf: string
          customer_name: string
          customer_phone: string
          error_message: string | null
          id: string
          message_text: string
          order_id: string | null
          restaurant_id: string
          rule_id: string | null
          scheduled_for: string
          sent_at: string | null
          status: string | null
        }
        Insert: {
          campaign_id?: string | null
          coupon_code?: string | null
          created_at?: string | null
          customer_cpf: string
          customer_name: string
          customer_phone: string
          error_message?: string | null
          id?: string
          message_text: string
          order_id?: string | null
          restaurant_id: string
          rule_id?: string | null
          scheduled_for: string
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          campaign_id?: string | null
          coupon_code?: string | null
          created_at?: string | null
          customer_cpf?: string
          customer_name?: string
          customer_phone?: string
          error_message?: string | null
          id?: string
          message_text?: string
          order_id?: string | null
          restaurant_id?: string
          rule_id?: string | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_scheduled_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_scheduled_messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_scheduled_messages_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_scheduled_messages_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaign_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_imports: {
        Row: {
          arquivo_xml: string | null
          cnpj_fornecedor: string | null
          created_at: string | null
          data_emissao: string | null
          id: string
          nome_fornecedor: string | null
          numero_nota: string
          restaurant_id: string
          valor_total: number | null
        }
        Insert: {
          arquivo_xml?: string | null
          cnpj_fornecedor?: string | null
          created_at?: string | null
          data_emissao?: string | null
          id?: string
          nome_fornecedor?: string | null
          numero_nota: string
          restaurant_id: string
          valor_total?: number | null
        }
        Update: {
          arquivo_xml?: string | null
          cnpj_fornecedor?: string | null
          created_at?: string | null
          data_emissao?: string | null
          id?: string
          nome_fornecedor?: string | null
          numero_nota?: string
          restaurant_id?: string
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nfe_imports_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      online_payment_config: {
        Row: {
          accept_card: boolean | null
          accept_pix: boolean | null
          connected_at: string | null
          connection_status: string | null
          created_at: string | null
          enable_for_delivery: boolean | null
          enabled: boolean | null
          id: string
          mp_access_token: string | null
          mp_external_pos_id: string | null
          mp_pos_id: string | null
          mp_pos_name: string | null
          mp_public_key: string | null
          mp_refresh_token: string | null
          mp_sandbox_payer_email: string | null
          mp_user_id: string | null
          provider: string | null
          require_prepayment: boolean | null
          restaurant_id: string
          token_expires_at: string | null
          updated_at: string | null
        }
        Insert: {
          accept_card?: boolean | null
          accept_pix?: boolean | null
          connected_at?: string | null
          connection_status?: string | null
          created_at?: string | null
          enable_for_delivery?: boolean | null
          enabled?: boolean | null
          id?: string
          mp_access_token?: string | null
          mp_external_pos_id?: string | null
          mp_pos_id?: string | null
          mp_pos_name?: string | null
          mp_public_key?: string | null
          mp_refresh_token?: string | null
          mp_sandbox_payer_email?: string | null
          mp_user_id?: string | null
          provider?: string | null
          require_prepayment?: boolean | null
          restaurant_id: string
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Update: {
          accept_card?: boolean | null
          accept_pix?: boolean | null
          connected_at?: string | null
          connection_status?: string | null
          created_at?: string | null
          enable_for_delivery?: boolean | null
          enabled?: boolean | null
          id?: string
          mp_access_token?: string | null
          mp_external_pos_id?: string | null
          mp_pos_id?: string | null
          mp_pos_name?: string | null
          mp_public_key?: string | null
          mp_refresh_token?: string | null
          mp_sandbox_payer_email?: string | null
          mp_user_id?: string | null
          provider?: string | null
          require_prepayment?: boolean | null
          restaurant_id?: string
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "online_payment_config_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      online_payments: {
        Row: {
          amount: number
          created_at: string | null
          customer_cpf: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          id: string
          order_id: string | null
          paid_at: string | null
          payment_method: string | null
          pix_expiration: string | null
          pix_qr_code: string | null
          pix_qr_code_base64: string | null
          provider: string
          provider_payment_id: string | null
          provider_preference_id: string | null
          restaurant_id: string
          status: string | null
          updated_at: string | null
          webhook_received_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          customer_cpf?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          order_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          pix_expiration?: string | null
          pix_qr_code?: string | null
          pix_qr_code_base64?: string | null
          provider?: string
          provider_payment_id?: string | null
          provider_preference_id?: string | null
          restaurant_id: string
          status?: string | null
          updated_at?: string | null
          webhook_received_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          customer_cpf?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          order_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          pix_expiration?: string | null
          pix_qr_code?: string | null
          pix_qr_code_base64?: string | null
          provider?: string
          provider_payment_id?: string | null
          provider_preference_id?: string | null
          restaurant_id?: string
          status?: string | null
          updated_at?: string | null
          webhook_received_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "online_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_payments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_costs: {
        Row: {
          created_at: string | null
          fixed_cost: number
          id: string
          labor_cost: number
          month_year: string
          restaurant_id: string
          updated_at: string | null
          variable_cost: number
          variable_cost_type: string
        }
        Insert: {
          created_at?: string | null
          fixed_cost?: number
          id?: string
          labor_cost?: number
          month_year: string
          restaurant_id: string
          updated_at?: string | null
          variable_cost?: number
          variable_cost_type?: string
        }
        Update: {
          created_at?: string | null
          fixed_cost?: number
          id?: string
          labor_cost?: number
          month_year?: string
          restaurant_id?: string
          updated_at?: string | null
          variable_cost?: number
          variable_cost_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "operational_costs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_fiscal_notes: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string
          nfe_key: string | null
          nfe_number: string | null
          nuvem_fiscal_ref: string | null
          order_id: string
          pdf_url: string | null
          restaurant_id: string
          status: string
          updated_at: string | null
          url_consulta: string | null
          url_qrcode: string | null
          xml_url: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          nfe_key?: string | null
          nfe_number?: string | null
          nuvem_fiscal_ref?: string | null
          order_id: string
          pdf_url?: string | null
          restaurant_id: string
          status?: string
          updated_at?: string | null
          url_consulta?: string | null
          url_qrcode?: string | null
          xml_url?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          nfe_key?: string | null
          nfe_number?: string | null
          nuvem_fiscal_ref?: string | null
          order_id?: string
          pdf_url?: string | null
          restaurant_id?: string
          status?: string
          updated_at?: string | null
          url_consulta?: string | null
          url_qrcode?: string | null
          xml_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_fiscal_notes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_fiscal_notes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_extras: {
        Row: {
          created_at: string | null
          extra_name: string | null
          id: string
          order_item_id: string
          price_at_order: number
          product_extra_id: string | null
        }
        Insert: {
          created_at?: string | null
          extra_name?: string | null
          id?: string
          order_item_id: string
          price_at_order: number
          product_extra_id?: string | null
        }
        Update: {
          created_at?: string | null
          extra_name?: string | null
          id?: string
          order_item_id?: string
          price_at_order?: number
          product_extra_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_item_extras_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_extras_product_extra_id_fkey"
            columns: ["product_extra_id"]
            isOneToOne: false
            referencedRelation: "product_extras"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_splits: {
        Row: {
          created_at: string | null
          id: string
          order_id: string
          order_item_id: string
          paid_at: string | null
          payment_type: string | null
          restaurant_id: string
          split_number: number
          status: string
          total_splits: number
          value: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          order_id: string
          order_item_id: string
          paid_at?: string | null
          payment_type?: string | null
          restaurant_id: string
          split_number: number
          status?: string
          total_splits: number
          value: number
        }
        Update: {
          created_at?: string | null
          id?: string
          order_id?: string
          order_item_id?: string
          paid_at?: string | null
          payment_type?: string | null
          restaurant_id?: string
          split_number?: number
          status?: string
          total_splits?: number
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_splits_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_splits_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_splits_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          order_id: string
          price_at_order: number
          product_id: string | null
          quantity: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          order_id: string
          price_at_order: number
          product_id?: string | null
          quantity?: number
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          order_id?: string
          price_at_order?: number
          product_id?: string | null
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancellation_reason: string | null
          comanda_id: string | null
          coupon_code: string | null
          coupon_discount: number | null
          created_at: string | null
          customer_cpf: string
          customer_name: string
          daily_order_number: number | null
          dd_order_id: string | null
          dd_scheduled_for: string | null
          dd_source: boolean | null
          delivery_address: string | null
          delivery_city: string | null
          delivery_fee: number | null
          delivery_neighborhood: string | null
          delivery_phone: string | null
          delivery_type: string | null
          id: string
          ifood_display_id: string | null
          ifood_merchant_id: string | null
          ifood_order_id: string | null
          ifood_source: boolean | null
          loyalty_points_earned: number | null
          loyalty_points_used: number | null
          notes: string | null
          online_payment_id: string | null
          order_channel: string | null
          order_type: string | null
          paid_at: string | null
          payment_brand: string | null
          payment_status: string | null
          payment_type: string | null
          pdv_source: boolean
          restaurant_id: string
          reward_discount: number | null
          reward_id: string | null
          service_fee: number
          status: string | null
          table_id: string | null
          updated_at: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          comanda_id?: string | null
          coupon_code?: string | null
          coupon_discount?: number | null
          created_at?: string | null
          customer_cpf: string
          customer_name: string
          daily_order_number?: number | null
          dd_order_id?: string | null
          dd_scheduled_for?: string | null
          dd_source?: boolean | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_fee?: number | null
          delivery_neighborhood?: string | null
          delivery_phone?: string | null
          delivery_type?: string | null
          id?: string
          ifood_display_id?: string | null
          ifood_merchant_id?: string | null
          ifood_order_id?: string | null
          ifood_source?: boolean | null
          loyalty_points_earned?: number | null
          loyalty_points_used?: number | null
          notes?: string | null
          online_payment_id?: string | null
          order_channel?: string | null
          order_type?: string | null
          paid_at?: string | null
          payment_brand?: string | null
          payment_status?: string | null
          payment_type?: string | null
          pdv_source?: boolean
          restaurant_id: string
          reward_discount?: number | null
          reward_id?: string | null
          service_fee?: number
          status?: string | null
          table_id?: string | null
          updated_at?: string | null
        }
        Update: {
          cancellation_reason?: string | null
          comanda_id?: string | null
          coupon_code?: string | null
          coupon_discount?: number | null
          created_at?: string | null
          customer_cpf?: string
          customer_name?: string
          daily_order_number?: number | null
          dd_order_id?: string | null
          dd_scheduled_for?: string | null
          dd_source?: boolean | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_fee?: number | null
          delivery_neighborhood?: string | null
          delivery_phone?: string | null
          delivery_type?: string | null
          id?: string
          ifood_display_id?: string | null
          ifood_merchant_id?: string | null
          ifood_order_id?: string | null
          ifood_source?: boolean | null
          loyalty_points_earned?: number | null
          loyalty_points_used?: number | null
          notes?: string | null
          online_payment_id?: string | null
          order_channel?: string | null
          order_type?: string | null
          paid_at?: string | null
          payment_brand?: string | null
          payment_status?: string | null
          payment_type?: string | null
          pdv_source?: boolean
          restaurant_id?: string
          reward_discount?: number | null
          reward_id?: string | null
          service_fee?: number
          status?: string | null
          table_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_comanda_id_fkey"
            columns: ["comanda_id"]
            isOneToOne: false
            referencedRelation: "comandas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_online_payment_id_fkey"
            columns: ["online_payment_id"]
            isOneToOne: false
            referencedRelation: "online_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "loyalty_program_rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_notification_config: {
        Row: {
          created_at: string
          daily_summary_time: string
          id: string
          owner_name: string | null
          owner_phone: string | null
          receive_cashier_close: boolean
          receive_cashier_open: boolean
          receive_daily_summary: boolean
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_summary_time?: string
          id?: string
          owner_name?: string | null
          owner_phone?: string | null
          receive_cashier_close?: boolean
          receive_cashier_open?: boolean
          receive_daily_summary?: boolean
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_summary_time?: string
          id?: string
          owner_name?: string | null
          owner_phone?: string | null
          receive_cashier_close?: boolean
          receive_cashier_open?: boolean
          receive_daily_summary?: boolean
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_notification_config_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          accepted_brands: string[] | null
          created_at: string | null
          id: string
          is_active: boolean | null
          method_type: string
          name: string
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          accepted_brands?: string[] | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          method_type: string
          name: string
          restaurant_id: string
          updated_at?: string | null
        }
        Update: {
          accepted_brands?: string[] | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          method_type?: string
          name?: string
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_payment_links: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          mp_subscription_link: string
          plan_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          mp_subscription_link: string
          plan_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          mp_subscription_link?: string
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_payment_links_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      point_order_payments: {
        Row: {
          amount: number
          created_at: string | null
          external_reference: string | null
          id: string
          idempotency_key: string
          mp_order_id: string
          mp_status_payload: Json | null
          mp_user_id: string | null
          order_id: string | null
          restaurant_id: string
          status: string | null
          terminal_id: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key: string
          mp_order_id: string
          mp_status_payload?: Json | null
          mp_user_id?: string | null
          order_id?: string | null
          restaurant_id: string
          status?: string | null
          terminal_id: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key?: string
          mp_order_id?: string
          mp_status_payload?: Json | null
          mp_user_id?: string | null
          order_id?: string | null
          restaurant_id?: string
          status?: string | null
          terminal_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "point_order_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_order_payments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      point_terminals: {
        Row: {
          configured_by: string | null
          created_at: string | null
          device_id: string
          device_name: string | null
          id: string
          is_active: boolean | null
          is_default_terminal: boolean | null
          last_seen_at: string | null
          mp_external_pos_id: string | null
          mp_external_store_id: string | null
          mp_pos_id: string | null
          mp_store_id: string | null
          operating_mode: string | null
          restaurant_id: string
          terminal_metadata: Json | null
          totem_id: string | null
          updated_at: string | null
          use_on_kiosk: boolean | null
        }
        Insert: {
          configured_by?: string | null
          created_at?: string | null
          device_id: string
          device_name?: string | null
          id?: string
          is_active?: boolean | null
          is_default_terminal?: boolean | null
          last_seen_at?: string | null
          mp_external_pos_id?: string | null
          mp_external_store_id?: string | null
          mp_pos_id?: string | null
          mp_store_id?: string | null
          operating_mode?: string | null
          restaurant_id: string
          terminal_metadata?: Json | null
          totem_id?: string | null
          updated_at?: string | null
          use_on_kiosk?: boolean | null
        }
        Update: {
          configured_by?: string | null
          created_at?: string | null
          device_id?: string
          device_name?: string | null
          id?: string
          is_active?: boolean | null
          is_default_terminal?: boolean | null
          last_seen_at?: string | null
          mp_external_pos_id?: string | null
          mp_external_store_id?: string | null
          mp_pos_id?: string | null
          mp_store_id?: string | null
          operating_mode?: string | null
          restaurant_id?: string
          terminal_metadata?: Json | null
          totem_id?: string | null
          updated_at?: string | null
          use_on_kiosk?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "point_terminals_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      polling_locks: {
        Row: {
          acquired_at: string
          lock_key: string
          owner: string | null
        }
        Insert: {
          acquired_at?: string
          lock_key: string
          owner?: string | null
        }
        Update: {
          acquired_at?: string
          lock_key?: string
          owner?: string | null
        }
        Relationships: []
      }
      printer_settings: {
        Row: {
          auto_print_orders: boolean
          auto_print_receipts: boolean
          created_at: string | null
          font_bold: boolean
          font_family: string
          font_size: number
          id: string
          kitchen_copy_auto_print: boolean
          kitchen_printer_name: string | null
          paper_size: string
          print_copies: number
          print_kitchen_copy: boolean
          print_method: string
          restaurant_id: string
          supports_auto_cut: boolean
          updated_at: string | null
        }
        Insert: {
          auto_print_orders?: boolean
          auto_print_receipts?: boolean
          created_at?: string | null
          font_bold?: boolean
          font_family?: string
          font_size?: number
          id?: string
          kitchen_copy_auto_print?: boolean
          kitchen_printer_name?: string | null
          paper_size?: string
          print_copies?: number
          print_kitchen_copy?: boolean
          print_method?: string
          restaurant_id: string
          supports_auto_cut?: boolean
          updated_at?: string | null
        }
        Update: {
          auto_print_orders?: boolean
          auto_print_receipts?: boolean
          created_at?: string | null
          font_bold?: boolean
          font_family?: string
          font_size?: number
          id?: string
          kitchen_copy_auto_print?: boolean
          kitchen_printer_name?: string | null
          paper_size?: string
          print_copies?: number
          print_kitchen_copy?: boolean
          print_method?: string
          restaurant_id?: string
          supports_auto_cut?: boolean
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "printer_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_complement_groups: {
        Row: {
          created_at: string | null
          display_order: number | null
          extra_category_id: string
          id: string
          is_required: boolean | null
          max_selection: number | null
          min_selection: number | null
          product_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          extra_category_id: string
          id?: string
          is_required?: boolean | null
          max_selection?: number | null
          min_selection?: number | null
          product_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          extra_category_id?: string
          id?: string
          is_required?: boolean | null
          max_selection?: number | null
          min_selection?: number | null
          product_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_complement_groups_extra_category_id_fkey"
            columns: ["extra_category_id"]
            isOneToOne: false
            referencedRelation: "extra_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_complement_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_extra_ingredients: {
        Row: {
          created_at: string | null
          id: string
          product_extra_id: string
          quantity: number
          stock_item_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          product_extra_id: string
          quantity?: number
          stock_item_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          product_extra_id?: string
          quantity?: number
          stock_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_extra_ingredients_product_extra_id_fkey"
            columns: ["product_extra_id"]
            isOneToOne: false
            referencedRelation: "product_extras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_extra_ingredients_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      product_extras: {
        Row: {
          created_at: string | null
          description: string | null
          extra_category_id: string | null
          id: string
          is_active: boolean | null
          is_required: boolean | null
          max_selection: number | null
          min_selection: number | null
          name: string
          pdv_code: string | null
          price: number
          product_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          extra_category_id?: string | null
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          max_selection?: number | null
          min_selection?: number | null
          name: string
          pdv_code?: string | null
          price?: number
          product_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          extra_category_id?: string | null
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          max_selection?: number | null
          min_selection?: number | null
          name?: string
          pdv_code?: string | null
          price?: number
          product_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_extras_extra_category_id_fkey"
            columns: ["extra_category_id"]
            isOneToOne: false
            referencedRelation: "extra_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_extras_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_ingredients: {
        Row: {
          created_at: string | null
          id: string
          product_id: string
          quantity: number
          stock_item_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          product_id: string
          quantity?: number
          stock_item_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          product_id?: string
          quantity?: number
          stock_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_ingredients_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_ingredients_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      product_upsells: {
        Row: {
          created_at: string
          discount_type: string
          discount_value: number
          id: string
          is_active: boolean
          restaurant_id: string
          trigger_category_id: string | null
          trigger_product_id: string | null
          trigger_type: string
          updated_at: string
          upsell_product_id: string
        }
        Insert: {
          created_at?: string
          discount_type?: string
          discount_value: number
          id?: string
          is_active?: boolean
          restaurant_id: string
          trigger_category_id?: string | null
          trigger_product_id?: string | null
          trigger_type?: string
          updated_at?: string
          upsell_product_id: string
        }
        Update: {
          created_at?: string
          discount_type?: string
          discount_value?: number
          id?: string
          is_active?: boolean
          restaurant_id?: string
          trigger_category_id?: string | null
          trigger_product_id?: string | null
          trigger_type?: string
          updated_at?: string
          upsell_product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_upsells_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_upsells_trigger_category_id_fkey"
            columns: ["trigger_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_upsells_trigger_product_id_fkey"
            columns: ["trigger_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_upsells_upsell_product_id_fkey"
            columns: ["upsell_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          available: boolean | null
          category_id: string | null
          created_at: string | null
          description: string | null
          featured_active: boolean | null
          featured_display_order: number | null
          featured_schedule: Json | null
          fiscal_aliquota_transparencia: number | null
          fiscal_beneficio_code: string | null
          fiscal_cbs_aliquota: number | null
          fiscal_cest: string | null
          fiscal_cfop: string | null
          fiscal_cofins_aliquota: number | null
          fiscal_cofins_cst: string | null
          fiscal_exception: string | null
          fiscal_ibs_aliquota: number | null
          fiscal_icms_csosn: string | null
          fiscal_icms_origin: string | null
          fiscal_indice_producao: number | null
          fiscal_ncm: string | null
          fiscal_pis_aliquota: number | null
          fiscal_pis_cst: string | null
          id: string
          image_url: string | null
          is_featured: boolean | null
          name: string
          pdv_code: string | null
          prep_time_minutes: number | null
          price: number
          promotional_price: number | null
          restaurant_id: string
          updated_at: string | null
          visibility_channels: string[] | null
        }
        Insert: {
          available?: boolean | null
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          featured_active?: boolean | null
          featured_display_order?: number | null
          featured_schedule?: Json | null
          fiscal_aliquota_transparencia?: number | null
          fiscal_beneficio_code?: string | null
          fiscal_cbs_aliquota?: number | null
          fiscal_cest?: string | null
          fiscal_cfop?: string | null
          fiscal_cofins_aliquota?: number | null
          fiscal_cofins_cst?: string | null
          fiscal_exception?: string | null
          fiscal_ibs_aliquota?: number | null
          fiscal_icms_csosn?: string | null
          fiscal_icms_origin?: string | null
          fiscal_indice_producao?: number | null
          fiscal_ncm?: string | null
          fiscal_pis_aliquota?: number | null
          fiscal_pis_cst?: string | null
          id?: string
          image_url?: string | null
          is_featured?: boolean | null
          name: string
          pdv_code?: string | null
          prep_time_minutes?: number | null
          price: number
          promotional_price?: number | null
          restaurant_id: string
          updated_at?: string | null
          visibility_channels?: string[] | null
        }
        Update: {
          available?: boolean | null
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          featured_active?: boolean | null
          featured_display_order?: number | null
          featured_schedule?: Json | null
          fiscal_aliquota_transparencia?: number | null
          fiscal_beneficio_code?: string | null
          fiscal_cbs_aliquota?: number | null
          fiscal_cest?: string | null
          fiscal_cfop?: string | null
          fiscal_cofins_aliquota?: number | null
          fiscal_cofins_cst?: string | null
          fiscal_exception?: string | null
          fiscal_ibs_aliquota?: number | null
          fiscal_icms_csosn?: string | null
          fiscal_icms_origin?: string | null
          fiscal_indice_producao?: number | null
          fiscal_ncm?: string | null
          fiscal_pis_aliquota?: number | null
          fiscal_pis_cst?: string | null
          id?: string
          image_url?: string | null
          is_featured?: boolean | null
          name?: string
          pdv_code?: string | null
          prep_time_minutes?: number | null
          price?: number
          promotional_price?: number | null
          restaurant_id?: string
          updated_at?: string | null
          visibility_channels?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          cpf: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          cpf?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          cpf?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      remarketing_lists: {
        Row: {
          created_at: string | null
          customer_count: number | null
          filters: Json | null
          id: string
          name: string
          restaurant_id: string
          type: string | null
        }
        Insert: {
          created_at?: string | null
          customer_count?: number | null
          filters?: Json | null
          id?: string
          name: string
          restaurant_id: string
          type?: string | null
        }
        Update: {
          created_at?: string | null
          customer_count?: number | null
          filters?: Json | null
          id?: string
          name?: string
          restaurant_id?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "remarketing_lists_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      remote_configs: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      reservation_hours: {
        Row: {
          close_time: string | null
          created_at: string | null
          day_of_week: number
          id: string
          is_open: boolean | null
          open_time: string | null
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          close_time?: string | null
          created_at?: string | null
          day_of_week: number
          id?: string
          is_open?: boolean | null
          open_time?: string | null
          restaurant_id: string
          updated_at?: string | null
        }
        Update: {
          close_time?: string | null
          created_at?: string | null
          day_of_week?: number
          id?: string
          is_open?: boolean | null
          open_time?: string | null
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_hours_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_tables: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          id: string
          image_url: string | null
          is_available: boolean | null
          max_capacity: number
          min_capacity: number
          restaurant_id: string
          table_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          max_capacity?: number
          min_capacity?: number
          restaurant_id: string
          table_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          max_capacity?: number
          min_capacity?: number
          restaurant_id?: string
          table_name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_tables_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string | null
          customer_cpf: string
          customer_name: string
          customer_phone: string
          id: string
          notes: string | null
          party_size: number
          reservation_date: string
          reservation_table_id: string | null
          reservation_time: string
          restaurant_id: string
          status: string | null
          table_id: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          customer_cpf: string
          customer_name: string
          customer_phone: string
          id?: string
          notes?: string | null
          party_size: number
          reservation_date: string
          reservation_table_id?: string | null
          reservation_time: string
          restaurant_id: string
          status?: string | null
          table_id?: string | null
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          customer_cpf?: string
          customer_name?: string
          customer_phone?: string
          id?: string
          notes?: string | null
          party_size?: number
          reservation_date?: string
          reservation_table_id?: string | null
          reservation_time?: string
          restaurant_id?: string
          status?: string | null
          table_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_credentials: {
        Row: {
          created_at: string | null
          id: string
          password_hash: string
          restaurant_id: string
          username: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          password_hash: string
          restaurant_id: string
          username: string
        }
        Update: {
          created_at?: string | null
          id?: string
          password_hash?: string
          restaurant_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_credentials_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_reviews: {
        Row: {
          bill_id: string | null
          comment: string | null
          counter_order_id: string | null
          created_at: string
          id: string
          order_id: string | null
          rating: number
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          bill_id?: string | null
          comment?: string | null
          counter_order_id?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          rating: number
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          bill_id?: string | null
          comment?: string | null
          counter_order_id?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          rating?: number
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_reviews_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_reviews_counter_order_id_fkey"
            columns: ["counter_order_id"]
            isOneToOne: false
            referencedRelation: "counter_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_reviews_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_staff: {
        Row: {
          allowed_sections: Json
          can_manage_orders: boolean
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          password_hash: string
          receives_order_notifications: boolean
          restaurant_id: string
          role: string
          updated_at: string
          username: string
        }
        Insert: {
          allowed_sections?: Json
          can_manage_orders?: boolean
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          password_hash: string
          receives_order_notifications?: boolean
          restaurant_id: string
          role?: string
          updated_at?: string
          username: string
        }
        Update: {
          allowed_sections?: Json
          can_manage_orders?: boolean
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          password_hash?: string
          receives_order_notifications?: boolean
          restaurant_id?: string
          role?: string
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_staff_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_subscriptions: {
        Row: {
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          expires_at: string | null
          failed_payments: number
          grace_period_ends_at: string | null
          grace_period_start: string | null
          id: string
          in_grace_period: boolean
          is_trial: boolean | null
          last_payment_at: string | null
          mp_preapproval_id: string | null
          next_payment_at: string | null
          pending_downgrade_at: string | null
          pending_downgrade_plan_id: string | null
          pending_upgrade_plan_id: string | null
          plan_id: string
          restaurant_id: string
          started_at: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          expires_at?: string | null
          failed_payments?: number
          grace_period_ends_at?: string | null
          grace_period_start?: string | null
          id?: string
          in_grace_period?: boolean
          is_trial?: boolean | null
          last_payment_at?: string | null
          mp_preapproval_id?: string | null
          next_payment_at?: string | null
          pending_downgrade_at?: string | null
          pending_downgrade_plan_id?: string | null
          pending_upgrade_plan_id?: string | null
          plan_id: string
          restaurant_id: string
          started_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          expires_at?: string | null
          failed_payments?: number
          grace_period_ends_at?: string | null
          grace_period_start?: string | null
          id?: string
          in_grace_period?: boolean
          is_trial?: boolean | null
          last_payment_at?: string | null
          mp_preapproval_id?: string | null
          next_payment_at?: string | null
          pending_downgrade_at?: string | null
          pending_downgrade_plan_id?: string | null
          pending_upgrade_plan_id?: string | null
          plan_id?: string
          restaurant_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_subscriptions_pending_downgrade_plan_id_fkey"
            columns: ["pending_downgrade_plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_subscriptions_pending_upgrade_plan_id_fkey"
            columns: ["pending_upgrade_plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_subscriptions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          auto_accept_orders: boolean
          auto_open_close: boolean | null
          banner_url: string | null
          bill_request_enabled: boolean | null
          certificado_digital_ref: string | null
          cnpj: string | null
          created_at: string | null
          endereco_fiscal: string | null
          facebook_pixel_id: string | null
          featured_section_enabled: boolean | null
          featured_section_title: string | null
          id: string
          inscricao_estadual: string | null
          is_open: boolean | null
          login_require_birth_date: boolean | null
          login_require_cpf: boolean
          login_require_name: boolean | null
          login_require_phone: boolean | null
          logo_url: string | null
          loyalty_enabled: boolean | null
          loyalty_points_per_real: number | null
          loyalty_real_per_point: number | null
          mp_payer_email: string | null
          municipio_codigo: string | null
          name: string
          pending_plan_slug: string | null
          pickup_time_minutes: number | null
          prep_time_minutes: number | null
          primary_color: string | null
          rating: number | null
          razao_social: string | null
          reservations_enabled: boolean | null
          reservations_follow_business_hours: boolean | null
          review_count: number | null
          secondary_color: string | null
          service_fee_enabled: boolean | null
          service_fee_percentage: number | null
          show_prep_timer: boolean | null
          slug: string
          target_cmv_percentage: number | null
          trial_ends_at: string | null
          trial_expired: boolean | null
          trial_started_at: string | null
          uf: string | null
          updated_at: string | null
        }
        Insert: {
          auto_accept_orders?: boolean
          auto_open_close?: boolean | null
          banner_url?: string | null
          bill_request_enabled?: boolean | null
          certificado_digital_ref?: string | null
          cnpj?: string | null
          created_at?: string | null
          endereco_fiscal?: string | null
          facebook_pixel_id?: string | null
          featured_section_enabled?: boolean | null
          featured_section_title?: string | null
          id?: string
          inscricao_estadual?: string | null
          is_open?: boolean | null
          login_require_birth_date?: boolean | null
          login_require_cpf?: boolean
          login_require_name?: boolean | null
          login_require_phone?: boolean | null
          logo_url?: string | null
          loyalty_enabled?: boolean | null
          loyalty_points_per_real?: number | null
          loyalty_real_per_point?: number | null
          mp_payer_email?: string | null
          municipio_codigo?: string | null
          name: string
          pending_plan_slug?: string | null
          pickup_time_minutes?: number | null
          prep_time_minutes?: number | null
          primary_color?: string | null
          rating?: number | null
          razao_social?: string | null
          reservations_enabled?: boolean | null
          reservations_follow_business_hours?: boolean | null
          review_count?: number | null
          secondary_color?: string | null
          service_fee_enabled?: boolean | null
          service_fee_percentage?: number | null
          show_prep_timer?: boolean | null
          slug: string
          target_cmv_percentage?: number | null
          trial_ends_at?: string | null
          trial_expired?: boolean | null
          trial_started_at?: string | null
          uf?: string | null
          updated_at?: string | null
        }
        Update: {
          auto_accept_orders?: boolean
          auto_open_close?: boolean | null
          banner_url?: string | null
          bill_request_enabled?: boolean | null
          certificado_digital_ref?: string | null
          cnpj?: string | null
          created_at?: string | null
          endereco_fiscal?: string | null
          facebook_pixel_id?: string | null
          featured_section_enabled?: boolean | null
          featured_section_title?: string | null
          id?: string
          inscricao_estadual?: string | null
          is_open?: boolean | null
          login_require_birth_date?: boolean | null
          login_require_cpf?: boolean
          login_require_name?: boolean | null
          login_require_phone?: boolean | null
          logo_url?: string | null
          loyalty_enabled?: boolean | null
          loyalty_points_per_real?: number | null
          loyalty_real_per_point?: number | null
          mp_payer_email?: string | null
          municipio_codigo?: string | null
          name?: string
          pending_plan_slug?: string | null
          pickup_time_minutes?: number | null
          prep_time_minutes?: number | null
          primary_color?: string | null
          rating?: number | null
          razao_social?: string | null
          reservations_enabled?: boolean | null
          reservations_follow_business_hours?: boolean | null
          review_count?: number | null
          secondary_color?: string | null
          service_fee_enabled?: boolean | null
          service_fee_percentage?: number | null
          show_prep_timer?: boolean | null
          slug?: string
          target_cmv_percentage?: number | null
          trial_ends_at?: string | null
          trial_expired?: boolean | null
          trial_started_at?: string | null
          uf?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      staff_sessions: {
        Row: {
          created_at: string
          expires_at: string
          restaurant_id: string | null
          role: string | null
          staff_id: string | null
          token: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          restaurant_id?: string | null
          role?: string | null
          staff_id?: string | null
          token?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          restaurant_id?: string | null
          role?: string | null
          staff_id?: string | null
          token?: string
        }
        Relationships: []
      }
      stock_categories: {
        Row: {
          created_at: string | null
          id: string
          name: string
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          restaurant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_items: {
        Row: {
          category_id: string | null
          created_at: string | null
          current_quantity: number
          id: string
          is_active: boolean | null
          minimum_quantity: number
          name: string
          price_per_unit: number
          restaurant_id: string
          supplier_id: string | null
          unit: string
          updated_at: string | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string | null
          current_quantity?: number
          id?: string
          is_active?: boolean | null
          minimum_quantity?: number
          name: string
          price_per_unit?: number
          restaurant_id: string
          supplier_id?: string | null
          unit: string
          updated_at?: string | null
        }
        Update: {
          category_id?: string | null
          created_at?: string | null
          current_quantity?: number
          id?: string
          is_active?: boolean | null
          minimum_quantity?: number
          name?: string
          price_per_unit?: number
          restaurant_id?: string
          supplier_id?: string | null
          unit?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "stock_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string | null
          id: string
          movement_type: string
          order_id: string | null
          quantity: number
          reason: string | null
          stock_item_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          movement_type: string
          order_id?: string | null
          quantity: number
          reason?: string | null
          stock_item_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          movement_type?: string
          order_id?: string | null
          quantity?: number
          reason?: string | null
          stock_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_payments: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          payment_date: string | null
          reference_month: string
          restaurant_id: string
          status: string
          subscription_id: string
        }
        Insert: {
          amount?: number
          created_at?: string | null
          id?: string
          payment_date?: string | null
          reference_month: string
          restaurant_id: string
          status?: string
          subscription_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          payment_date?: string | null
          reference_month?: string
          restaurant_id?: string
          status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "restaurant_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          created_at: string | null
          description: string | null
          features: Json
          id: string
          is_active: boolean | null
          name: string
          price: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean | null
          name: string
          price?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          cnpj: string | null
          contact_name: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          restaurant_id: string
          updated_at: string | null
        }
        Insert: {
          cnpj?: string | null
          contact_name?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          restaurant_id: string
          updated_at?: string | null
        }
        Update: {
          cnpj?: string | null
          contact_name?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          restaurant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      tables: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          id: string
          image_url: string | null
          is_available_for_reservation: boolean | null
          is_hidden: boolean
          is_occupied: boolean | null
          max_capacity: number | null
          min_capacity: number | null
          occupied_at: string | null
          occupied_by: string | null
          qr_code: string | null
          restaurant_id: string
          table_name: string | null
          table_number: number
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          image_url?: string | null
          is_available_for_reservation?: boolean | null
          is_hidden?: boolean
          is_occupied?: boolean | null
          max_capacity?: number | null
          min_capacity?: number | null
          occupied_at?: string | null
          occupied_by?: string | null
          qr_code?: string | null
          restaurant_id: string
          table_name?: string | null
          table_number: number
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          image_url?: string | null
          is_available_for_reservation?: boolean | null
          is_hidden?: boolean
          is_occupied?: boolean | null
          max_capacity?: number | null
          min_capacity?: number | null
          occupied_at?: string | null
          occupied_by?: string | null
          qr_code?: string | null
          restaurant_id?: string
          table_name?: string | null
          table_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "tables_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          restaurant_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          restaurant_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          restaurant_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      variable_costs: {
        Row: {
          amount: number | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          percentage: number | null
          restaurant_id: string
          type: string
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          percentage?: number | null
          restaurant_id: string
          type: string
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          percentage?: number | null
          restaurant_id?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "variable_costs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_ai_config: {
        Row: {
          accept_orders_via_whatsapp: boolean | null
          created_at: string | null
          custom_welcome_message: string | null
          id: string
          instructions: string | null
          is_active: boolean | null
          personality: string | null
          restaurant_id: string
          updated_at: string | null
          welcome_message_type: string | null
        }
        Insert: {
          accept_orders_via_whatsapp?: boolean | null
          created_at?: string | null
          custom_welcome_message?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean | null
          personality?: string | null
          restaurant_id: string
          updated_at?: string | null
          welcome_message_type?: string | null
        }
        Update: {
          accept_orders_via_whatsapp?: boolean | null
          created_at?: string | null
          custom_welcome_message?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean | null
          personality?: string | null
          restaurant_id?: string
          updated_at?: string | null
          welcome_message_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_ai_config_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_config: {
        Row: {
          api_token: string | null
          connected_at: string | null
          connected_phone: string | null
          created_at: string | null
          enabled: boolean | null
          id: string
          instance_name: string | null
          instance_status: string | null
          message_accepted: string | null
          message_cancelled: string | null
          message_delivered: string | null
          message_out_for_delivery: string | null
          message_payment_approved: string | null
          message_payment_rejected: string | null
          message_picked_up: string | null
          message_ready_for_pickup: string | null
          message_reservation_cancelled: string | null
          message_reservation_confirmed: string | null
          message_reservation_created: string | null
          phone_number: string | null
          restaurant_id: string
          review_link_url: string | null
          updated_at: string | null
        }
        Insert: {
          api_token?: string | null
          connected_at?: string | null
          connected_phone?: string | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          instance_name?: string | null
          instance_status?: string | null
          message_accepted?: string | null
          message_cancelled?: string | null
          message_delivered?: string | null
          message_out_for_delivery?: string | null
          message_payment_approved?: string | null
          message_payment_rejected?: string | null
          message_picked_up?: string | null
          message_ready_for_pickup?: string | null
          message_reservation_cancelled?: string | null
          message_reservation_confirmed?: string | null
          message_reservation_created?: string | null
          phone_number?: string | null
          restaurant_id: string
          review_link_url?: string | null
          updated_at?: string | null
        }
        Update: {
          api_token?: string | null
          connected_at?: string | null
          connected_phone?: string | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          instance_name?: string | null
          instance_status?: string | null
          message_accepted?: string | null
          message_cancelled?: string | null
          message_delivered?: string | null
          message_out_for_delivery?: string | null
          message_payment_approved?: string | null
          message_payment_rejected?: string | null
          message_picked_up?: string | null
          message_ready_for_pickup?: string | null
          message_reservation_cancelled?: string | null
          message_reservation_confirmed?: string | null
          message_reservation_created?: string | null
          phone_number?: string | null
          restaurant_id?: string
          review_link_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_config_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          bot_paused: boolean | null
          bot_paused_until: string | null
          created_at: string | null
          current_step: string | null
          customer_phone: string
          id: string
          last_message_at: string | null
          order_draft: Json | null
          paused_reason: string | null
          restaurant_id: string
        }
        Insert: {
          bot_paused?: boolean | null
          bot_paused_until?: string | null
          created_at?: string | null
          current_step?: string | null
          customer_phone: string
          id?: string
          last_message_at?: string | null
          order_draft?: Json | null
          paused_reason?: string | null
          restaurant_id: string
        }
        Update: {
          bot_paused?: boolean | null
          bot_paused_until?: string | null
          created_at?: string | null
          current_step?: string | null
          customer_phone?: string
          id?: string
          last_message_at?: string | null
          order_draft?: Json | null
          paused_reason?: string | null
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_inbound_events: {
        Row: {
          created_at: string
          id: string
          message_id: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_inbound_events_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_menu_options: {
        Row: {
          action_type: string
          created_at: string | null
          custom_message: string | null
          id: string
          is_active: boolean | null
          label: string
          position: number
          restaurant_id: string
        }
        Insert: {
          action_type: string
          created_at?: string | null
          custom_message?: string | null
          id?: string
          is_active?: boolean | null
          label: string
          position: number
          restaurant_id: string
        }
        Update: {
          action_type?: string
          created_at?: string | null
          custom_message?: string | null
          id?: string
          is_active?: boolean | null
          label?: string
          position?: number
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_menu_options_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_notification_configs: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          notification_type: string
          restaurant_id: string
          send_delay_minutes: number
          template_message: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          notification_type: string
          restaurant_id: string
          send_delay_minutes?: number
          template_message?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          notification_type?: string
          restaurant_id?: string
          send_delay_minutes?: number
          template_message?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_notification_configs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _app_token: { Args: never; Returns: string }
      add_customer_address: {
        Args: {
          p_city: string
          p_complement?: string
          p_cpf: string
          p_is_default?: boolean
          p_name: string
          p_neighborhood: string
          p_number: string
          p_phone: string
          p_state: string
          p_street: string
          p_zip_code: string
        }
        Returns: string
      }
      admin_cancel_order_item: {
        Args: { p_order_item_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_cancel_order_item_secured_impl_17473: {
        Args: { p_order_item_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_check_has_staff: {
        Args: { p_restaurant_id: string }
        Returns: boolean
      }
      admin_create_first_staff: {
        Args: {
          p_allowed_sections?: string
          p_display_name: string
          p_password_hash: string
          p_restaurant_id: string
          p_role?: string
          p_username: string
        }
        Returns: string
      }
      admin_create_staff: {
        Args: {
          p_allowed_sections: string
          p_display_name: string
          p_password_hash: string
          p_restaurant_id: string
          p_role: string
          p_username: string
        }
        Returns: undefined
      }
      admin_create_staff_secured_impl_17476: {
        Args: {
          p_allowed_sections: string
          p_display_name: string
          p_password_hash: string
          p_restaurant_id: string
          p_role: string
          p_username: string
        }
        Returns: undefined
      }
      admin_delete_bill: {
        Args: { p_bill_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_bill_and_orders: {
        Args: { p_bill_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_bill_and_orders_secured_impl_17478: {
        Args: { p_bill_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_bill_secured_impl_17477: {
        Args: { p_bill_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_category: {
        Args: { p_category_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_category_secured_impl_17479: {
        Args: { p_category_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_ceo_user: { Args: { p_id: string }; Returns: undefined }
      admin_delete_order: {
        Args: { p_order_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_order_and_bill: {
        Args: { p_order_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_order_and_bill_secured_impl_17482: {
        Args: { p_order_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_order_secured_impl_17481: {
        Args: { p_order_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_payment_config: {
        Args: { p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_payment_config_secured_impl_17483: {
        Args: { p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_point_terminal: {
        Args: { p_device_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_point_terminal_secured_impl_17484: {
        Args: { p_device_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_product: {
        Args: { p_product_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_product_extra: {
        Args: { p_product_extra_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_product_extra_secured_impl_17486: {
        Args: { p_product_extra_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_product_secured_impl_17485: {
        Args: { p_product_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_delete_staff: {
        Args: { p_restaurant_id: string; p_staff_id: string }
        Returns: boolean
      }
      admin_delete_staff_secured_impl_17487: {
        Args: { p_restaurant_id: string; p_staff_id: string }
        Returns: boolean
      }
      admin_delete_stock_item: {
        Args: { p_restaurant_id: string; p_stock_item_id: string }
        Returns: undefined
      }
      admin_delete_stock_item_secured_impl_17488: {
        Args: { p_restaurant_id: string; p_stock_item_id: string }
        Returns: undefined
      }
      admin_ensure_payment_config: {
        Args: { p_restaurant_id: string }
        Returns: string
      }
      admin_ensure_payment_config_secured_impl_17489: {
        Args: { p_restaurant_id: string }
        Returns: string
      }
      admin_get_dd_config: { Args: { p_restaurant_id: string }; Returns: Json }
      admin_get_dd_config_secured_impl_17490: {
        Args: { p_restaurant_id: string }
        Returns: Json
      }
      admin_get_fiscal_config: {
        Args: { p_restaurant_id: string }
        Returns: Json
      }
      admin_get_ifood_config: {
        Args: { p_restaurant_id: string }
        Returns: Json
      }
      admin_get_ifood_config_secured_impl_17492: {
        Args: { p_restaurant_id: string }
        Returns: Json
      }
      admin_get_payment_config: {
        Args: { p_restaurant_id: string }
        Returns: {
          accept_card: boolean
          accept_pix: boolean
          connected_at: string
          connection_status: string
          enable_for_delivery: boolean
          enabled: boolean
          id: string
          mp_access_token: string
          mp_public_key: string
          mp_refresh_token: string
          mp_sandbox_payer_email: string
          provider: string
          restaurant_id: string
        }[]
      }
      admin_get_payment_config_secured_impl_17493: {
        Args: { p_restaurant_id: string }
        Returns: {
          accept_card: boolean
          accept_pix: boolean
          connected_at: string
          connection_status: string
          enable_for_delivery: boolean
          enabled: boolean
          id: string
          mp_access_token: string
          mp_public_key: string
          mp_refresh_token: string
          mp_sandbox_payer_email: string
          provider: string
          restaurant_id: string
        }[]
      }
      admin_get_pix_pos_config: {
        Args: { p_restaurant_id: string }
        Returns: {
          mp_pos_id: string
          mp_pos_name: string
          mp_user_id: string
        }[]
      }
      admin_get_point_terminals: {
        Args: { p_restaurant_id: string }
        Returns: {
          configured_by: string
          created_at: string
          device_id: string
          device_name: string
          id: string
          is_active: boolean
          is_default_terminal: boolean
          last_seen_at: string
          mp_external_pos_id: string
          mp_external_store_id: string
          mp_pos_id: string
          mp_store_id: string
          operating_mode: string
          restaurant_id: string
          terminal_metadata: Json
          totem_id: string
          updated_at: string
          use_on_kiosk: boolean
        }[]
      }
      admin_get_point_terminals_secured_impl_17495: {
        Args: { p_restaurant_id: string }
        Returns: {
          configured_by: string
          created_at: string
          device_id: string
          device_name: string
          id: string
          is_active: boolean
          is_default_terminal: boolean
          last_seen_at: string
          mp_external_pos_id: string
          mp_external_store_id: string
          mp_pos_id: string
          mp_store_id: string
          operating_mode: string
          restaurant_id: string
          terminal_metadata: Json
          totem_id: string
          updated_at: string
          use_on_kiosk: boolean
        }[]
      }
      admin_get_whatsapp_status: {
        Args: { p_restaurant_id: string }
        Returns: {
          enabled: boolean
          instance_status: string
        }[]
      }
      admin_get_whatsapp_status_secured_impl_17496: {
        Args: { p_restaurant_id: string }
        Returns: {
          enabled: boolean
          instance_status: string
        }[]
      }
      admin_list_ceo_users: {
        Args: never
        Returns: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          username: string
        }[]
      }
      admin_list_staff: {
        Args: { p_restaurant_id: string }
        Returns: {
          allowed_sections: Json
          can_manage_orders: boolean
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          receives_order_notifications: boolean
          role: string
          username: string
        }[]
      }
      admin_list_staff_secured_impl_17498: {
        Args: { p_restaurant_id: string }
        Returns: {
          allowed_sections: Json
          can_manage_orders: boolean
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          receives_order_notifications: boolean
          role: string
          username: string
        }[]
      }
      admin_mark_bill_on_the_way: {
        Args: { p_bill_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_mark_bill_on_the_way_secured_impl_17499: {
        Args: { p_bill_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_mark_bill_paid: {
        Args: { p_bill_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_mark_bill_paid_secured_impl_17500: {
        Args: { p_bill_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      admin_toggle_dd: {
        Args: { p_enabled: boolean; p_restaurant_id: string }
        Returns: undefined
      }
      admin_toggle_dd_secured_impl_17501: {
        Args: { p_enabled: boolean; p_restaurant_id: string }
        Returns: undefined
      }
      admin_toggle_ifood: {
        Args: { p_enabled: boolean; p_restaurant_id: string }
        Returns: undefined
      }
      admin_toggle_ifood_secured_impl_17502: {
        Args: { p_enabled: boolean; p_restaurant_id: string }
        Returns: undefined
      }
      admin_toggle_staff_active: {
        Args: { p_restaurant_id: string; p_staff_id: string }
        Returns: boolean
      }
      admin_toggle_staff_active_secured_impl_17503: {
        Args: { p_restaurant_id: string; p_staff_id: string }
        Returns: boolean
      }
      admin_update_fiscal_config: {
        Args: { p_restaurant_id: string; p_updates: Json }
        Returns: undefined
      }
      admin_update_order_status: {
        Args: {
          p_new_status: string
          p_order_id: string
          p_restaurant_id: string
        }
        Returns: undefined
      }
      admin_update_order_status_secured_impl_17505: {
        Args: {
          p_new_status: string
          p_order_id: string
          p_restaurant_id: string
        }
        Returns: undefined
      }
      admin_update_restaurant_settings: {
        Args: {
          p_prep_time_minutes: number
          p_primary_color: string
          p_restaurant_id: string
          p_service_fee_enabled: boolean
          p_service_fee_percentage: number
          p_target_cmv_percentage: number
        }
        Returns: undefined
      }
      admin_update_restaurant_settings_secured_impl_17506: {
        Args: {
          p_prep_time_minutes: number
          p_primary_color: string
          p_restaurant_id: string
          p_service_fee_enabled: boolean
          p_service_fee_percentage: number
          p_target_cmv_percentage: number
        }
        Returns: undefined
      }
      admin_upsert_ceo_user: {
        Args: {
          p_display_name?: string
          p_id?: string
          p_password_hash?: string
          p_username?: string
        }
        Returns: undefined
      }
      admin_upsert_fiscal_config: {
        Args: { p_data: Json; p_restaurant_id: string }
        Returns: undefined
      }
      admin_upsert_payment_config: {
        Args: { p_field: string; p_restaurant_id: string; p_value?: string }
        Returns: undefined
      }
      admin_upsert_payment_config_secured_impl_17509: {
        Args: { p_field: string; p_restaurant_id: string; p_value?: string }
        Returns: undefined
      }
      admin_upsert_point_terminal: {
        Args: {
          p_configured_by?: string
          p_device_id: string
          p_device_name?: string
          p_is_default_terminal?: boolean
          p_mp_external_pos_id?: string
          p_mp_external_store_id?: string
          p_mp_pos_id?: string
          p_mp_store_id?: string
          p_operating_mode?: string
          p_restaurant_id: string
          p_terminal_metadata?: Json
          p_totem_id?: string
          p_use_on_kiosk?: boolean
        }
        Returns: string
      }
      admin_upsert_point_terminal_secured_impl_17510: {
        Args: {
          p_configured_by?: string
          p_device_id: string
          p_device_name?: string
          p_is_default_terminal?: boolean
          p_mp_external_pos_id?: string
          p_mp_external_store_id?: string
          p_mp_pos_id?: string
          p_mp_store_id?: string
          p_operating_mode?: string
          p_restaurant_id: string
          p_terminal_metadata?: Json
          p_totem_id?: string
          p_use_on_kiosk?: boolean
        }
        Returns: string
      }
      admin_upsert_staff:
        | {
            Args: {
              p_allowed_sections?: string
              p_display_name?: string
              p_id?: string
              p_password_hash?: string
              p_restaurant_id: string
              p_role?: string
              p_username?: string
            }
            Returns: string
          }
        | {
            Args: {
              p_allowed_sections?: string
              p_can_manage_orders?: boolean
              p_display_name?: string
              p_id?: string
              p_password_hash?: string
              p_receives_order_notifications?: boolean
              p_restaurant_id: string
              p_role?: string
              p_username?: string
            }
            Returns: string
          }
      admin_upsert_staff_secured_impl_17511: {
        Args: {
          p_allowed_sections?: string
          p_display_name?: string
          p_id?: string
          p_password_hash?: string
          p_restaurant_id: string
          p_role?: string
          p_username?: string
        }
        Returns: string
      }
      admin_upsert_staff_secured_impl_17512: {
        Args: {
          p_allowed_sections?: string
          p_can_manage_orders?: boolean
          p_display_name?: string
          p_id?: string
          p_password_hash?: string
          p_receives_order_notifications?: boolean
          p_restaurant_id: string
          p_role?: string
          p_username?: string
        }
        Returns: string
      }
      apply_loyalty: {
        Args: {
          p_cpf: string
          p_order_id?: string
          p_points: number
          p_type: string
        }
        Returns: number
      }
      auto_release_idle_tables: { Args: never; Returns: undefined }
      auto_release_inactive_tables: { Args: never; Returns: undefined }
      check_bill_exists: { Args: { p_bill_id: string }; Returns: string }
      check_mp_token_expiry: {
        Args: { p_restaurant_id: string }
        Returns: {
          expires_at: string
          has_token: boolean
          is_expired: boolean
        }[]
      }
      check_mp_token_expiry_secured_impl_17516: {
        Args: { p_restaurant_id: string }
        Returns: {
          expires_at: string
          has_token: boolean
          is_expired: boolean
        }[]
      }
      check_product_availability: {
        Args: { p_product_id: string }
        Returns: boolean
      }
      cleanup_abandoned_tables: { Args: never; Returns: undefined }
      count_active_comandas_for_table: {
        Args: { p_table_id: string }
        Returns: number
      }
      create_ceo_session: {
        Args: { p_password: string; p_username: string }
        Returns: {
          ceo_user_id: string
          display_name: string
          expires_at: string
          token: string
        }[]
      }
      create_kiosk_order: {
        Args: {
          p_coupon_code?: string
          p_coupon_discount?: number
          p_customer_cpf: string
          p_customer_name: string
          p_delivery_address?: string
          p_delivery_phone?: string
          p_delivery_type: string
          p_items?: Json
          p_loyalty_points_used?: number
          p_notes?: string
          p_order_type: string
          p_restaurant_id: string
          p_reward_discount?: number
          p_table_number?: number
        }
        Returns: string
      }
      create_staff_session: {
        Args: {
          p_password: string
          p_restaurant_id: string
          p_username: string
        }
        Returns: {
          allowed_sections: Json
          display_name: string
          expires_at: string
          role: string
          staff_id: string
          token: string
        }[]
      }
      cron_ifood_polling_30s: { Args: never; Returns: undefined }
      current_restaurant_id: { Args: never; Returns: string }
      current_staff_id: { Args: never; Returns: string }
      current_staff_role: { Args: never; Returns: string }
      customer_phone_taken: {
        Args: { p_exclude_cpf?: string; p_phone: string }
        Returns: boolean
      }
      deduct_stock_for_order_item: {
        Args: { p_order_item_id: string }
        Returns: undefined
      }
      default_restaurant_id: { Args: never; Returns: string }
      delete_customer_address: {
        Args: { p_cpf: string; p_id: string }
        Returns: boolean
      }
      delete_saved_card: {
        Args: { p_cpf: string; p_id: string }
        Returns: boolean
      }
      finalize_order_payment: {
        Args: {
          p_comanda_id?: string
          p_online_payment_id?: string
          p_order_id: string
          p_payment_brand?: string
          p_payment_status?: string
          p_payment_type?: string
          p_status?: string
        }
        Returns: boolean
      }
      get_active_bill: {
        Args: { p_comanda_id?: string; p_table_id: string }
        Returns: {
          id: string
          status: string
        }[]
      }
      get_comanda_orders: {
        Args: {
          p_comanda_id?: string
          p_customer_cpf?: string
          p_table_id: string
        }
        Returns: Json
      }
      get_comanda_status: {
        Args: { p_cpf: string; p_table_id: string }
        Returns: {
          closed_at: string
          created_at: string
          id: string
          status: string
          table_id: string
        }[]
      }
      get_comanda_status_by_id: {
        Args: { p_comanda_id: string }
        Returns: {
          id: string
          status: string
          table_id: string
        }[]
      }
      get_customer_by_cpf: {
        Args: { p_cpf: string }
        Returns: {
          cpf: string
          email: string
          id: string
          name: string
          phone: string
        }[]
      }
      get_customer_coupons: {
        Args: { p_cpf: string }
        Returns: {
          coupon_code: string
        }[]
      }
      get_customer_orders: {
        Args: { p_cpf: string; p_phone: string }
        Returns: {
          cancellation_reason: string | null
          comanda_id: string | null
          coupon_code: string | null
          coupon_discount: number | null
          created_at: string | null
          customer_cpf: string
          customer_name: string
          daily_order_number: number | null
          dd_order_id: string | null
          dd_scheduled_for: string | null
          dd_source: boolean | null
          delivery_address: string | null
          delivery_city: string | null
          delivery_fee: number | null
          delivery_neighborhood: string | null
          delivery_phone: string | null
          delivery_type: string | null
          id: string
          ifood_display_id: string | null
          ifood_merchant_id: string | null
          ifood_order_id: string | null
          ifood_source: boolean | null
          loyalty_points_earned: number | null
          loyalty_points_used: number | null
          notes: string | null
          online_payment_id: string | null
          order_channel: string | null
          order_type: string | null
          paid_at: string | null
          payment_brand: string | null
          payment_status: string | null
          payment_type: string | null
          pdv_source: boolean
          restaurant_id: string
          reward_discount: number | null
          reward_id: string | null
          service_fee: number
          status: string | null
          table_id: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_kiosk_point_terminal: {
        Args: { p_restaurant_id: string }
        Returns: {
          device_id: string
          device_name: string
          mp_pos_id: string
          mp_store_id: string
        }[]
      }
      get_loyalty_balance: { Args: { p_cpf: string }; Returns: number }
      get_my_reservations: {
        Args: { p_cpf: string; p_phone: string }
        Returns: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string | null
          customer_cpf: string
          customer_name: string
          customer_phone: string
          id: string
          notes: string | null
          party_size: number
          reservation_date: string
          reservation_table_id: string | null
          reservation_time: string
          restaurant_id: string
          status: string | null
          table_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "reservations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_order_details: { Args: { p_order_id: string }; Returns: Json }
      get_order_status: { Args: { p_order_id: string }; Returns: string }
      get_paid_bill_for_comanda: {
        Args: { p_comanda_id: string }
        Returns: string
      }
      get_payment_status: {
        Args: { p_payment_id: string }
        Returns: {
          paid_at: string
          status: string
        }[]
      }
      get_point_order_payment: {
        Args: { p_mp_order_id: string }
        Returns: {
          amount: number
          external_reference: string
          id: string
          idempotency_key: string
          mp_order_id: string
          mp_status_payload: Json
          mp_user_id: string
          order_id: string
          restaurant_id: string
          status: string
          terminal_id: string
        }[]
      }
      get_public_payment_config: {
        Args: { p_restaurant_id: string }
        Returns: {
          accept_card: boolean
          accept_pix: boolean
          connection_status: string
          enable_for_delivery: boolean
          enabled: boolean
          id: string
          mp_public_key: string
          restaurant_id: string
        }[]
      }
      get_reservation_availability: {
        Args: { p_date: string }
        Returns: {
          reservation_date: string
          reservation_table_id: string
          reservation_time: string
          status: string
        }[]
      }
      get_restaurant_rating_stats: {
        Args: { p_restaurant_id: string }
        Returns: {
          average_rating: number
          total_reviews: number
        }[]
      }
      get_saved_cards: {
        Args: { p_cpf: string; p_phone: string }
        Returns: {
          expiration_month: number
          expiration_year: number
          id: string
          last_four_digits: string
          payment_method_id: string
        }[]
      }
      get_table_pending_orders_total: {
        Args: {
          p_comanda_id?: string
          p_customer_cpf?: string
          p_customer_name?: string
          p_table_id: string
        }
        Returns: number
      }
      get_whatsapp_public_config: {
        Args: { p_restaurant_id: string }
        Returns: {
          enabled: boolean
          instance_status: string
          message_reservation_created: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_coupon_usage: {
        Args: { p_coupon_id: string }
        Returns: undefined
      }
      insert_point_order_payment: {
        Args: {
          p_amount?: number
          p_external_reference?: string
          p_idempotency_key?: string
          p_mp_order_id?: string
          p_mp_user_id?: string
          p_order_id?: string
          p_restaurant_id: string
          p_status?: string
          p_terminal_id?: string
        }
        Returns: undefined
      }
      is_ceo: { Args: never; Returns: boolean }
      is_restaurant_admin: {
        Args: { rest_id: string; user_uuid: string }
        Returns: boolean
      }
      is_restaurant_closed_by_order_item: {
        Args: { _order_item_id: string }
        Returns: boolean
      }
      is_staff: { Args: never; Returns: boolean }
      list_customer_addresses: {
        Args: { p_cpf: string; p_phone: string }
        Returns: {
          city: string
          complement: string | null
          created_at: string | null
          customer_cpf: string
          customer_name: string
          customer_phone: string
          id: string
          is_default: boolean | null
          neighborhood: string
          number: string
          restaurant_id: string | null
          state: string
          street: string
          updated_at: string | null
          zip_code: string
        }[]
        SetofOptions: {
          from: "*"
          to: "customer_addresses"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_reward_redemptions: {
        Args: { p_cpf: string; p_program_id: string }
        Returns: {
          reward_id: string
        }[]
      }
      order_in_default_restaurant: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      order_item_in_default_restaurant: {
        Args: { p_order_item_id: string }
        Returns: boolean
      }
      record_reward_redemption: {
        Args: {
          p_cpf: string
          p_order_id?: string
          p_program_id: string
          p_reward_id: string
          p_trigger_value?: number
        }
        Returns: boolean
      }
      redeem_coupon: { Args: { p_code: string }; Returns: boolean }
      release_polling_lock: { Args: { _key: string }; Returns: boolean }
      restore_stock_for_order_item: {
        Args: { p_order_item_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      restore_stock_for_order_item_secured_impl_17539: {
        Args: { p_order_item_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      set_customer_phone_if_empty: {
        Args: { p_cpf: string; p_phone: string; p_restaurant_id: string }
        Returns: undefined
      }
      table_has_activity: { Args: { p_table_id: string }; Returns: boolean }
      track_customer_session: {
        Args: {
          p_fields?: Json
          p_restaurant_id: string
          p_session_token: string
        }
        Returns: undefined
      }
      trigger_ifood_polling_all: { Args: never; Returns: undefined }
      try_acquire_polling_lock: {
        Args: { _key: string; _owner?: string; _ttl_seconds?: number }
        Returns: boolean
      }
      update_point_order_payment: {
        Args: {
          p_mp_order_id: string
          p_mp_status_payload?: Json
          p_status: string
        }
        Returns: undefined
      }
      upsert_customer: {
        Args: {
          p_cpf: string
          p_email?: string
          p_name: string
          p_phone?: string
        }
        Returns: string
      }
      validate_ceo_credentials: {
        Args: { p_password: string; p_username: string }
        Returns: {
          ceo_user_id: string
          display_name: string
        }[]
      }
      validate_coupon: {
        Args: { p_code: string }
        Returns: {
          code: string
          coupon_type: string | null
          created_at: string | null
          discount_type: string
          discount_value: number
          id: string
          is_active: boolean | null
          max_discount: number | null
          min_order_value: number | null
          restaurant_id: string
          target_extra_id: string | null
          target_product_extra_id: string | null
          target_product_id: string | null
          updated_at: string | null
          usage_limit: number | null
          usage_limit_per_user: number | null
          used_count: number | null
          valid_from: string | null
          valid_until: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "coupons"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      validate_restaurant_credentials: {
        Args: { p_password: string; p_username: string }
        Returns: {
          restaurant_id: string
          restaurant_name: string
        }[]
      }
      validate_staff_credentials: {
        Args: {
          p_password: string
          p_restaurant_id: string
          p_username: string
        }
        Returns: {
          allowed_sections: Json
          can_manage_orders: boolean
          display_name: string
          receives_order_notifications: boolean
          role: string
          staff_id: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "ceo" | "restaurant_admin" | "user" | "dev"
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
      app_role: ["admin", "ceo", "restaurant_admin", "user", "dev"],
    },
  },
} as const
