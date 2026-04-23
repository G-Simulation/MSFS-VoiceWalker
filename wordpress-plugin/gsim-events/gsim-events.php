<?php
/**
 * Plugin Name:       G-Sim Events (MSFSVoiceWalker)
 * Description:       Event-Hosting-Plattform für MSFSVoiceWalker. Ermöglicht Veranstaltern, öffentliche Fly-Ins / Air-Races / Formation-Flights anzulegen, Tickets zu verkaufen (via WooCommerce) und Teilnehmer mit Join-Link/Passphrase zu versorgen. Ersatz für Event Tickets Plus (rein kostenlos).
 * Version:           0.1.0
 * Author:            G-Simulation
 * Author URI:        https://www.gsimulations.de
 * License:           Apache-2.0
 * Text Domain:       gsim-events
 * Requires Plugins:  woocommerce, the-events-calendar
 */

if (!defined('ABSPATH')) exit;

define('GSIM_EVENTS_VERSION',     '0.1.0');
define('GSIM_EVENTS_APP_URL',     'http://127.0.0.1:7801');      // Local-App-Join-URL (Browser des Teilnehmers)
define('GSIM_EVENTS_PASS_SALT',   'msfsvoicewalker-private-v1'); // MUSS mit web/app.js::PRIVATE_ROOM_SALT matchen
define('GSIM_EVENTS_ROLE',        'event_organizer');
define('GSIM_EVENTS_CPT_ATTENDEE','gsim_event_attendee');

// Product-Meta-Key: verknüpft WC-Produkt mit tribe_events-Post
define('GSIM_EVENTS_META_TICKET_EVENT', '_gsim_ticket_event_id');
// Event-Meta-Keys: auto-generiert beim Save
define('GSIM_EVENTS_META_PASSPHRASE',   '_gsim_event_passphrase');
define('GSIM_EVENTS_META_JOIN_URL',     '_gsim_event_join_url');
define('GSIM_EVENTS_META_VISIBILITY',   '_gsim_event_visibility');  // 'public' | 'private'

// WC-Produkt-ID des "Fly-In Event Hosting"-Produkts. Beim Kauf dieses Produkts
// wird der Käufer zum event_organizer. Kann via Filter überschrieben werden.
function gsim_events_hosting_product_id() {
    return (int) apply_filters('gsim_events_hosting_product_id', 975);
}

// -----------------------------------------------------------------------------
// Aktivierung / Deaktivierung
// -----------------------------------------------------------------------------

function gsim_events_role_caps() {
    return [
        'read'                            => true,
        'upload_files'                    => true,
        // tribe_events Capabilities (nur eigene Events managen)
        'edit_tribe_events'               => true,
        'edit_published_tribe_events'     => true,
        'publish_tribe_events'            => true,
        'delete_tribe_events'             => true,
        'delete_published_tribe_events'   => true,
        'read_private_tribe_events'       => true,
        'edit_tribe_venues'               => true,
        'publish_tribe_venues'            => true,
        'edit_published_tribe_venues'     => true,
        'edit_tribe_organizers'           => true,
        'publish_tribe_organizers'        => true,
        'edit_published_tribe_organizers' => true,
        // eigene Attendee-Listen lesen
        'edit_' . GSIM_EVENTS_CPT_ATTENDEE . 's'           => true,
        'read_' . GSIM_EVENTS_CPT_ATTENDEE                 => true,
    ];
}

register_activation_hook(__FILE__, function () {
    $caps = gsim_events_role_caps();
    if (!get_role(GSIM_EVENTS_ROLE)) {
        add_role(GSIM_EVENTS_ROLE, 'Event Organizer', $caps);
    } else {
        // Existing role: refresh capabilities (falls Plugin-Update neue caps mitbringt)
        $role = get_role(GSIM_EVENTS_ROLE);
        foreach ($caps as $cap => $grant) $role->add_cap($cap, $grant);
    }
    gsim_events_register_attendee_cpt();
    flush_rewrite_rules();
});

register_deactivation_hook(__FILE__, function () {
    flush_rewrite_rules();
    // Rolle absichtlich NICHT entfernen — sonst verlieren bestehende Veranstalter ihre Rechte bei Update-Problemen.
});

// -----------------------------------------------------------------------------
// Custom Post Type: Attendee (Teilnehmer-Datensatz pro Ticket-Kauf)
// -----------------------------------------------------------------------------

function gsim_events_register_attendee_cpt() {
    register_post_type(GSIM_EVENTS_CPT_ATTENDEE, [
        'labels' => [
            'name'          => 'Event-Teilnehmer',
            'singular_name' => 'Teilnehmer',
            'menu_name'     => 'Teilnehmer',
        ],
        'public'       => false,
        'show_ui'      => true,
        'show_in_menu' => 'edit.php?post_type=tribe_events',
        'supports'     => ['title', 'custom-fields'],
        'capability_type' => GSIM_EVENTS_CPT_ATTENDEE,
        'map_meta_cap'    => true,
        'show_in_rest'    => false,
    ]);
}
add_action('init', 'gsim_events_register_attendee_cpt');

// -----------------------------------------------------------------------------
// Event-Save-Hook: Passphrase + Join-URL automatisch generieren
// -----------------------------------------------------------------------------

add_action('save_post_tribe_events', function ($post_id, $post, $update) {
    // Kein Auto-Save / Revision
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    if (wp_is_post_revision($post_id))               return;
    if ($post->post_status === 'auto-draft')         return;

    $pass = get_post_meta($post_id, GSIM_EVENTS_META_PASSPHRASE, true);
    if (empty($pass)) {
        // Passphrase: "flyin-<slug>-<6-hex>" — menschenlesbar + unique genug
        $slug = sanitize_title($post->post_title ?: 'event');
        $slug = substr($slug, 0, 24);
        $suffix = wp_generate_password(6, false, false);
        $pass = 'flyin-' . $slug . '-' . strtolower($suffix);
        update_post_meta($post_id, GSIM_EVENTS_META_PASSPHRASE, $pass);
    }
    $join = GSIM_EVENTS_APP_URL . '/?join=' . rawurlencode($pass);
    update_post_meta($post_id, GSIM_EVENTS_META_JOIN_URL, $join);
}, 10, 3);

// -----------------------------------------------------------------------------
// Admin-UI: Meta-Box "MSFSVoiceWalker Event-Details" auf tribe_events
// -----------------------------------------------------------------------------

add_action('add_meta_boxes_tribe_events', function () {
    add_meta_box(
        'gsim_events_voicewalker',
        'MSFSVoiceWalker — Event-Details',
        function ($post) {
            $pass = get_post_meta($post->ID, GSIM_EVENTS_META_PASSPHRASE, true);
            $join = get_post_meta($post->ID, GSIM_EVENTS_META_JOIN_URL, true);
            ?>
            <p><strong>Passphrase</strong> (auto-generiert, wird beim ersten Speichern gesetzt):<br>
               <code><?php echo esc_html($pass ?: '—'); ?></code></p>
            <p><strong>Direkt-Join-Link</strong> — dieser Link landet im PDF-Briefing und in der Event-Ankündigung:<br>
               <code><?php echo esc_html($join ?: '—'); ?></code></p>
            <p style="color:#888;font-size:12px">
               Teilnehmer klickt auf den Link → MSFSVoiceWalker-App öffnet sich → tritt automatisch dem privaten Raum bei.
               Voraussetzung: Teilnehmer hat Pro (oder Event-Gast-Code, später).
            </p>
            <?php
        },
        'tribe_events',
        'side',
        'default'
    );
});

// -----------------------------------------------------------------------------
// WC-Produkt: Meta-Feld "Verknüpft mit Event" (verwandelt Produkt in "Ticket")
// -----------------------------------------------------------------------------

add_action('woocommerce_product_options_general_product_data', function () {
    global $post;
    // Alle zukünftigen + vergangenen Events als Dropdown
    $events = get_posts([
        'post_type'   => 'tribe_events',
        'numberposts' => 200,
        'post_status' => ['publish', 'draft', 'future'],
        'orderby'     => 'date',
        'order'       => 'DESC',
    ]);
    $current = get_post_meta($post->ID, GSIM_EVENTS_META_TICKET_EVENT, true);
    echo '<div class="options_group">';
    woocommerce_wp_select([
        'id'          => GSIM_EVENTS_META_TICKET_EVENT,
        'label'       => 'MSFSVoiceWalker: Event-Ticket für',
        'description' => 'Mache dieses Produkt zu einem Ticket für ein bestimmtes Event. Beim Kauf bekommt der Teilnehmer automatisch Join-Link + Passphrase per Mail.',
        'desc_tip'    => true,
        'options'     => array_merge(
            ['' => '— kein Event (normales Produkt) —'],
            array_reduce($events, function ($acc, $e) {
                $acc[$e->ID] = sprintf('#%d — %s', $e->ID, $e->post_title);
                return $acc;
            }, [])
        ),
        'value'       => $current,
    ]);
    echo '</div>';
});

add_action('woocommerce_process_product_meta', function ($post_id) {
    $val = isset($_POST[GSIM_EVENTS_META_TICKET_EVENT]) ? sanitize_text_field($_POST[GSIM_EVENTS_META_TICKET_EVENT]) : '';
    update_post_meta($post_id, GSIM_EVENTS_META_TICKET_EVENT, $val);
});

// -----------------------------------------------------------------------------
// WC Order completed: Käufer des Hosting-Produkts → event_organizer-Rolle
// -----------------------------------------------------------------------------

add_action('woocommerce_order_status_completed', function ($order_id) {
    $order = wc_get_order($order_id);
    if (!$order) return;
    $hosting_id = gsim_events_hosting_product_id();

    $buys_hosting = false;
    foreach ($order->get_items() as $item) {
        if ((int) $item->get_product_id() === $hosting_id) {
            $buys_hosting = true;
            break;
        }
    }
    if (!$buys_hosting) return;

    // User finden oder anlegen
    $email = $order->get_billing_email();
    if (!$email) return;
    $user  = get_user_by('email', $email);
    if (!$user) {
        $name = trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name());
        $login = sanitize_user(
            strtolower(($name ?: explode('@', $email)[0]) . wp_generate_password(3, false)),
            true
        );
        $pass = wp_generate_password(16, true);
        $user_id = wp_create_user($login, $pass, $email);
        if (is_wp_error($user_id)) return;
        wp_update_user(['ID' => $user_id, 'display_name' => $name ?: $login, 'role' => GSIM_EVENTS_ROLE]);
        // Passwort-Reset-Link zum Login schicken
        $reset_key = get_password_reset_key(get_user_by('id', $user_id));
        $login_url = network_site_url("wp-login.php?action=rp&key=$reset_key&login=" . rawurlencode($login), 'login');
        wp_mail($email,
            'Willkommen als MSFSVoiceWalker Event-Organizer',
            "Hallo,\n\n"
            . "danke für den Kauf des Event-Hosting-Pakets.\n\n"
            . "Dein Veranstalter-Account wurde erstellt:\n"
            . "  Login: $login\n"
            . "  Passwort festlegen: $login_url\n\n"
            . "Nach dem Einloggen siehst du im WP-Dashboard einen neuen Menüpunkt 'Veranstaltungen'.\n"
            . "Dort kannst du Events anlegen, Tickets erzeugen und Teilnehmerlisten einsehen.\n\n"
            . "Schnellstart-Guide: " . home_url('/veranstalter-dashboard') . "\n\n"
            . "— G-Simulation"
        );
    } else {
        $u = new WP_User($user->ID);
        if (!in_array(GSIM_EVENTS_ROLE, (array) $u->roles)) {
            $u->add_role(GSIM_EVENTS_ROLE);
            wp_mail($email,
                'Du kannst jetzt Events auf MSFSVoiceWalker veranstalten',
                "Hallo " . ($user->display_name ?: $user->user_login) . ",\n\n"
                . "dein Account wurde soeben als Event-Organizer freigeschaltet.\n"
                . "Nach dem nächsten Login siehst du im Dashboard den Menüpunkt 'Veranstaltungen'.\n\n"
                . "Dashboard: " . home_url('/veranstalter-dashboard') . "\n\n"
                . "— G-Simulation"
            );
        }
    }
}, 20);

// -----------------------------------------------------------------------------
// WC Order completed: Attendee-Datensatz anlegen + Mail mit Join-Link
// -----------------------------------------------------------------------------

add_action('woocommerce_order_status_completed', function ($order_id) {
    $order = wc_get_order($order_id);
    if (!$order) return;

    foreach ($order->get_items() as $item) {
        $product_id = $item->get_product_id();
        $event_id   = (int) get_post_meta($product_id, GSIM_EVENTS_META_TICKET_EVENT, true);
        if (!$event_id) continue;

        $event = get_post($event_id);
        if (!$event || $event->post_type !== 'tribe_events') continue;

        $pass = get_post_meta($event_id, GSIM_EVENTS_META_PASSPHRASE, true);
        $join = get_post_meta($event_id, GSIM_EVENTS_META_JOIN_URL, true);
        $customer_email = $order->get_billing_email();
        $customer_name  = trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name());

        // Attendee-Post anlegen (1 pro Ticket-Item)
        $qty = max(1, (int) $item->get_quantity());
        for ($i = 0; $i < $qty; $i++) {
            $attendee_id = wp_insert_post([
                'post_type'   => GSIM_EVENTS_CPT_ATTENDEE,
                'post_status' => 'publish',
                'post_title'  => sprintf('%s — %s', $event->post_title, $customer_name ?: $customer_email),
                'meta_input'  => [
                    '_event_id'      => $event_id,
                    '_order_id'      => $order_id,
                    '_product_id'    => $product_id,
                    '_attendee_name' => $customer_name,
                    '_attendee_email'=> $customer_email,
                    '_passphrase'    => $pass,
                    '_join_url'      => $join,
                ],
            ]);
        }

        // Mail an Teilnehmer
        $subject = sprintf('Dein Ticket: %s', $event->post_title);
        $event_date = tribe_get_start_date($event_id, true, 'd.m.Y H:i') ?: '—';
        $body = sprintf(
            "Hallo %s,\n\n"
            . "danke für deine Anmeldung zu \"%s\" (%s).\n\n"
            . "SO KOMMST DU INS EVENT:\n"
            . "1) MSFSVoiceWalker installieren: https://www.gsimulations.de/msfsvoicewalker\n"
            . "2) App starten\n"
            . "3) Diesen Link im Browser öffnen (App muss laufen):\n"
            . "   %s\n\n"
            . "Alternativ: Passphrase \"%s\" manuell unter 'Privater Raum' eintragen.\n\n"
            . "Viel Spaß beim Fliegen!\n"
            . "— G-Simulation",
            $customer_name ?: 'Pilot',
            $event->post_title,
            $event_date,
            $join,
            $pass
        );
        wp_mail($customer_email, $subject, $body);
    }
});

// -----------------------------------------------------------------------------
// Shortcode: [gsim_event_tickets event="123"]
// Rendert auf der Event-Seite die verknüpften Ticket-Produkte als Kauf-Buttons.
// -----------------------------------------------------------------------------

add_shortcode('gsim_event_tickets', function ($atts) {
    $atts = shortcode_atts(['event' => 0], $atts);
    $event_id = (int) $atts['event'];
    if (!$event_id) {
        // Fallback: aktuelle Loop-Post-ID nehmen
        $event_id = get_the_ID();
    }
    if (!$event_id) return '';

    // Alle Produkte finden die dieses Event als Ticket-Target haben
    $products = get_posts([
        'post_type'   => 'product',
        'numberposts' => 20,
        'meta_key'    => GSIM_EVENTS_META_TICKET_EVENT,
        'meta_value'  => $event_id,
        'post_status' => 'publish',
    ]);
    if (empty($products)) {
        return '<p><em>Dieses Event hat noch keine Tickets im Verkauf.</em></p>';
    }
    ob_start();
    echo '<div class="gsim-event-tickets" style="display:grid;gap:12px;margin:20px 0">';
    foreach ($products as $p) {
        $wc_product = wc_get_product($p->ID);
        if (!$wc_product) continue;
        $price = $wc_product->get_price_html();
        $stock = $wc_product->is_in_stock() ? ($wc_product->get_stock_quantity() ?: '∞') : 'ausverkauft';
        $url   = '/?add-to-cart=' . $p->ID;
        printf(
            '<div style="border:1px solid #ddd;padding:16px;border-radius:8px"><h4 style="margin:0 0 6px 0">%s</h4><p style="margin:0 0 10px 0">%s · Kapazität: %s</p>%s<a href="%s" class="button" style="background:#2f5cff;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none">Ticket kaufen</a></div>',
            esc_html($p->post_title),
            $price,
            esc_html($stock),
            wp_kses_post($wc_product->get_short_description()),
            esc_url($url)
        );
    }
    echo '</div>';
    return ob_get_clean();
});

// -----------------------------------------------------------------------------
// Public REST API — /wp-json/gsim-events/v1/
//
//   GET    /events                      List published events (paginated)
//   GET    /events/{id}                 Single event with passphrase + tickets
//   POST   /events                      Create event (organizer auth required)
//   PUT    /events/{id}                 Update own event (organizer auth)
//   DELETE /events/{id}                 Delete own event (organizer auth)
//   GET    /events/{id}/attendees       List attendees (own events + admin only)
//   POST   /events/{id}/tickets         Create a ticket (WC product) for event
//
// Auth: Application-Passwords (Basic Auth) for write endpoints. Read is public.
// -----------------------------------------------------------------------------

function gsim_events_shape_event($event) {
    $start = function_exists('tribe_get_start_date') ? tribe_get_start_date($event->ID, true, 'c') : null;
    $end   = function_exists('tribe_get_end_date')   ? tribe_get_end_date($event->ID, true, 'c')   : null;
    // Tickets (WC products linked to this event)
    $ticket_products = get_posts([
        'post_type'   => 'product',
        'numberposts' => 20,
        'meta_key'    => GSIM_EVENTS_META_TICKET_EVENT,
        'meta_value'  => $event->ID,
        'post_status' => 'publish',
    ]);
    $tickets = [];
    foreach ($ticket_products as $p) {
        $w = wc_get_product($p->ID);
        if (!$w) continue;
        $tickets[] = [
            'id'          => $p->ID,
            'name'        => $p->post_title,
            'price'       => (float) $w->get_price(),
            'currency'    => get_woocommerce_currency(),
            'stock'       => $w->get_stock_quantity(),
            'in_stock'    => $w->is_in_stock(),
            'purchase_url'=> wc_get_checkout_url() . '?add-to-cart=' . $p->ID,
        ];
    }
    $attendee_count = (int) (new WP_Query([
        'post_type'   => GSIM_EVENTS_CPT_ATTENDEE,
        'meta_key'    => '_event_id',
        'meta_value'  => $event->ID,
        'post_status' => 'publish',
        'fields'      => 'ids',
        'nopaging'    => true,
    ]))->found_posts;
    return [
        'id'             => $event->ID,
        'title'          => $event->post_title,
        'slug'           => $event->post_name,
        'description'    => wp_strip_all_tags($event->post_content),
        'description_html'=> apply_filters('the_content', $event->post_content),
        'status'         => $event->post_status,
        'author_id'      => (int) $event->post_author,
        'start'          => $start,
        'end'            => $end,
        'passphrase'     => get_post_meta($event->ID, GSIM_EVENTS_META_PASSPHRASE, true),
        'join_url'       => get_post_meta($event->ID, GSIM_EVENTS_META_JOIN_URL, true),
        'tickets'        => $tickets,
        'attendee_count' => $attendee_count,
        'url'            => get_permalink($event->ID),
    ];
}

function gsim_events_require_organizer($req) {
    if (!is_user_logged_in()) {
        return new WP_Error('rest_forbidden', 'Login erforderlich', ['status' => 401]);
    }
    $user = wp_get_current_user();
    if (!in_array(GSIM_EVENTS_ROLE, (array) $user->roles) && !user_can($user, 'manage_options')) {
        return new WP_Error('rest_forbidden', 'Event-Organizer-Rolle erforderlich', ['status' => 403]);
    }
    return true;
}

add_action('rest_api_init', function () {
    $ns = 'gsim-events/v1';

    // GET /events — Liste oeffentlicher Events (private rausgefiltert)
    register_rest_route($ns, '/events', [
        'methods'  => 'GET',
        'callback' => function ($req) {
            $meta_query = [
                'relation' => 'AND',
                [
                    'relation' => 'OR',
                    [ 'key' => GSIM_EVENTS_META_VISIBILITY, 'value' => 'private', 'compare' => '!=' ],
                    [ 'key' => GSIM_EVENTS_META_VISIBILITY, 'compare' => 'NOT EXISTS' ],
                ],
            ];
            if (!empty($req['upcoming'])) {
                $meta_query[] = [
                    'key'     => '_EventStartDate',
                    'value'   => current_time('mysql'),
                    'compare' => '>=',
                    'type'    => 'DATETIME',
                ];
            }
            $args = [
                'post_type'   => 'tribe_events',
                'post_status' => 'publish',
                'numberposts' => min(50, (int) ($req['per_page'] ?? 20)),
                'offset'      => max(0, (int) ($req['offset'] ?? 0)),
                'orderby'     => 'meta_value',
                'meta_key'    => '_EventStartDate',
                'order'       => 'ASC',
                'meta_query'  => $meta_query,
            ];
            $events = get_posts($args);
            return array_map('gsim_events_shape_event', $events);
        },
        'permission_callback' => '__return_true',
        'args' => [
            'per_page' => ['type' => 'integer', 'default' => 20],
            'offset'   => ['type' => 'integer', 'default' => 0],
            'upcoming' => ['type' => 'boolean', 'default' => false],
        ],
    ]);

    // GET /events/{id}
    register_rest_route($ns, '/events/(?P<id>\d+)', [
        'methods'  => 'GET',
        'callback' => function ($req) {
            $id = (int) $req['id'];
            $event = get_post($id);
            if (!$event || $event->post_type !== 'tribe_events' || $event->post_status !== 'publish') {
                return new WP_Error('not_found', 'Event nicht gefunden', ['status' => 404]);
            }
            return gsim_events_shape_event($event);
        },
        'permission_callback' => '__return_true',
    ]);

    // POST /events — Event anlegen (via TEC's tribe_create_event, damit
    // alle internen Rewrites / Taxonomien / Meta korrekt gesetzt werden).
    register_rest_route($ns, '/events', [
        'methods'  => 'POST',
        'callback' => function ($req) {
            $user_id = get_current_user_id();
            if (!function_exists('tribe_create_event')) {
                return new WP_Error('tec_missing', 'The Events Calendar muss aktiv sein', ['status' => 500]);
            }
            $start = !empty($req['start']) ? date('Y-m-d H:i:s', strtotime($req['start'])) : date('Y-m-d H:i:s');
            $end   = !empty($req['end'])   ? date('Y-m-d H:i:s', strtotime($req['end']))   : date('Y-m-d H:i:s', strtotime('+2 hours'));
            $event_id = tribe_create_event([
                'post_title'   => sanitize_text_field($req['title'] ?? 'Untitled Event'),
                'post_content' => wp_kses_post($req['description'] ?? ''),
                'post_status'  => sanitize_text_field($req['status'] ?? 'draft'),
                'post_author'  => $user_id,
                'EventStartDate' => $start,
                'EventEndDate'   => $end,
                'EventAllDay'    => false,
                'EventTimezone'  => wp_timezone_string(),
            ]);
            if (!$event_id || is_wp_error($event_id)) {
                return new WP_Error('create_failed', 'Event konnte nicht erstellt werden', ['status' => 500]);
            }
            // Passphrase wird durch save_post_tribe_events-Hook automatisch generiert
            return gsim_events_shape_event(get_post($event_id));
        },
        'permission_callback' => 'gsim_events_require_organizer',
        'args' => [
            'title'       => ['type' => 'string', 'required' => true],
            'description' => ['type' => 'string'],
            'start'       => ['type' => 'string', 'description' => 'ISO-8601'],
            'end'         => ['type' => 'string', 'description' => 'ISO-8601'],
            'status'      => ['type' => 'string', 'default' => 'draft', 'enum' => ['draft','publish']],
        ],
    ]);

    // PUT /events/{id}
    register_rest_route($ns, '/events/(?P<id>\d+)', [
        'methods'  => 'PUT',
        'callback' => function ($req) {
            $id = (int) $req['id'];
            $event = get_post($id);
            if (!$event || $event->post_type !== 'tribe_events') {
                return new WP_Error('not_found', 'Event nicht gefunden', ['status' => 404]);
            }
            $user_id = get_current_user_id();
            if ($event->post_author != $user_id && !user_can($user_id, 'manage_options')) {
                return new WP_Error('rest_forbidden', 'Nur eigene Events editierbar', ['status' => 403]);
            }
            $update = ['ID' => $id];
            if (isset($req['title']))       $update['post_title']   = sanitize_text_field($req['title']);
            if (isset($req['description'])) $update['post_content'] = wp_kses_post($req['description']);
            if (isset($req['status']))      $update['post_status']  = sanitize_text_field($req['status']);
            wp_update_post($update);
            if (isset($req['start']))       update_post_meta($id, '_EventStartDate', date('Y-m-d H:i:s', strtotime($req['start'])));
            if (isset($req['end']))         update_post_meta($id, '_EventEndDate',   date('Y-m-d H:i:s', strtotime($req['end'])));
            return gsim_events_shape_event(get_post($id));
        },
        'permission_callback' => 'gsim_events_require_organizer',
    ]);

    // DELETE /events/{id}
    register_rest_route($ns, '/events/(?P<id>\d+)', [
        'methods'  => 'DELETE',
        'callback' => function ($req) {
            $id = (int) $req['id'];
            $event = get_post($id);
            if (!$event || $event->post_type !== 'tribe_events') {
                return new WP_Error('not_found', 'Event nicht gefunden', ['status' => 404]);
            }
            $user_id = get_current_user_id();
            if ($event->post_author != $user_id && !user_can($user_id, 'manage_options')) {
                return new WP_Error('rest_forbidden', 'Nur eigene Events löschbar', ['status' => 403]);
            }
            wp_delete_post($id, true);
            return ['deleted' => true, 'id' => $id];
        },
        'permission_callback' => 'gsim_events_require_organizer',
    ]);

    // GET /events/{id}/attendees — Teilnehmer-Liste (eigene Events / Admin)
    register_rest_route($ns, '/events/(?P<id>\d+)/attendees', [
        'methods'  => 'GET',
        'callback' => function ($req) {
            $id = (int) $req['id'];
            $event = get_post($id);
            if (!$event) return new WP_Error('not_found', 'Event nicht gefunden', ['status' => 404]);
            $user_id = get_current_user_id();
            if ($event->post_author != $user_id && !user_can($user_id, 'manage_options')) {
                return new WP_Error('rest_forbidden', 'Nur eigene Events einsehbar', ['status' => 403]);
            }
            $atts = get_posts([
                'post_type'   => GSIM_EVENTS_CPT_ATTENDEE,
                'meta_key'    => '_event_id',
                'meta_value'  => $id,
                'numberposts' => 500,
                'post_status' => 'publish',
            ]);
            return array_map(function ($a) {
                return [
                    'id'         => $a->ID,
                    'name'       => get_post_meta($a->ID, '_attendee_name', true),
                    'email'      => get_post_meta($a->ID, '_attendee_email', true),
                    'order_id'   => (int) get_post_meta($a->ID, '_order_id', true),
                    'ticket_id'  => (int) get_post_meta($a->ID, '_product_id', true),
                    'created'    => $a->post_date,
                ];
            }, $atts);
        },
        'permission_callback' => 'gsim_events_require_organizer',
    ]);

    // POST /events/{id}/tickets — Ticket-Produkt erzeugen
    register_rest_route($ns, '/events/(?P<id>\d+)/tickets', [
        'methods'  => 'POST',
        'callback' => function ($req) {
            $event_id = (int) $req['id'];
            $event = get_post($event_id);
            if (!$event || $event->post_type !== 'tribe_events') {
                return new WP_Error('not_found', 'Event nicht gefunden', ['status' => 404]);
            }
            $user_id = get_current_user_id();
            if ($event->post_author != $user_id && !user_can($user_id, 'manage_options')) {
                return new WP_Error('rest_forbidden', 'Nur Event-Autor darf Tickets erzeugen', ['status' => 403]);
            }
            $product = new WC_Product_Simple();
            $product->set_name(sanitize_text_field($req['name'] ?? ($event->post_title . ' — Ticket')));
            $product->set_status('publish');
            $product->set_virtual(true);
            $product->set_catalog_visibility('hidden');   // nur über Event-Seite verkaufen
            $product->set_regular_price((string) (float) ($req['price'] ?? 0));
            $product->set_short_description(sanitize_text_field($req['description'] ?? ''));
            if (isset($req['capacity']) && $req['capacity'] > 0) {
                $product->set_manage_stock(true);
                $product->set_stock_quantity((int) $req['capacity']);
            }
            $pid = $product->save();
            update_post_meta($pid, GSIM_EVENTS_META_TICKET_EVENT, $event_id);
            return [
                'id'       => $pid,
                'name'     => $product->get_name(),
                'price'    => (float) $product->get_price(),
                'capacity' => $product->get_stock_quantity(),
                'event_id' => $event_id,
            ];
        },
        'permission_callback' => 'gsim_events_require_organizer',
        'args' => [
            'name'        => ['type' => 'string'],
            'price'       => ['type' => 'number', 'required' => true],
            'capacity'    => ['type' => 'integer'],
            'description' => ['type' => 'string'],
        ],
    ]);
});

// -----------------------------------------------------------------------------
// Frontend-Shortcode [gsim_organizer_form]
// Rendert ein Formular mit TinyMCE-Editor, Bild-Upload (featured image),
// Datums-Pickern und Tickets-Sektion — direkt auf einer WP-Seite nutzbar.
// Nur fuer eingeloggte Organizer sichtbar; andere sehen Login-Hinweis.
// -----------------------------------------------------------------------------

// Organizer hat keinen wp-admin-Zugang: Redirect zurueck auf die Frontend-Seite.
// Ausnahmen: /wp-login.php (zum Einloggen), AJAX, REST, Password-Reset.
add_action('admin_init', function () {
    if (!is_user_logged_in())                 return;
    if (wp_doing_ajax() || wp_doing_cron())   return;
    $user = wp_get_current_user();
    if (user_can($user, 'manage_options'))    return;   // Admin darf
    if (!in_array(GSIM_EVENTS_ROLE, (array) $user->roles)) return;
    // Nur event_organizer (keine andere Rolle) → auf Frontend umleiten
    $only_organizer = count(array_diff((array) $user->roles, [GSIM_EVENTS_ROLE, 'customer', 'subscriber'])) === 0;
    if ($only_organizer) {
        wp_safe_redirect(home_url('/events-verwalten/'));
        exit;
    }
});
// Admin-Bar: fuer Organizer minimieren (nur "Meine Events"-Shortcut behalten)
add_action('admin_bar_menu', function ($wp_admin_bar) {
    if (!is_user_logged_in()) return;
    $user = wp_get_current_user();
    $is_organizer = in_array(GSIM_EVENTS_ROLE, (array) $user->roles) && !user_can($user, 'manage_options');
    if ($is_organizer) {
        // Alle Standard-Items entfernen
        foreach (['wp-logo','site-name','updates','comments','new-content','edit','customize'] as $node) {
            $wp_admin_bar->remove_node($node);
        }
    }
    // Prominenter "Meine Events"-Button fuer Organizer + Admins
    if ($is_organizer || user_can($user, 'manage_options')) {
        $wp_admin_bar->add_node([
            'id'    => 'gsim-events-shortcut',
            'title' => '📅 Meine Events',
            'href'  => home_url('/events-verwalten/'),
            'meta'  => ['class' => 'gsim-events-shortcut'],
        ]);
    }
}, 100);

// Floating "Meine Events"-Button auf jeder Frontend-Seite fuer Organizer.
// Unabhaengig von Admin-Bar, damit User nie den Einstieg verliert.
add_action('wp_footer', function () {
    if (!is_user_logged_in()) return;
    $user = wp_get_current_user();
    if (!in_array(GSIM_EVENTS_ROLE, (array) $user->roles) && !user_can($user, 'manage_options')) return;
    // Auf der Editor-Seite selbst nicht anzeigen
    if (is_page('events-verwalten')) return;
    $url = home_url('/events-verwalten/');
    echo '<a id="gsim-organizer-fab" href="' . esc_url($url) . '" style="'
        . 'position:fixed;bottom:24px;right:24px;z-index:9999;'
        . 'background:linear-gradient(135deg,#2f5cff,#6aa5ff);color:#fff;'
        . 'padding:12px 18px;border-radius:999px;font-weight:700;font-size:14px;'
        . 'text-decoration:none;box-shadow:0 4px 20px rgba(47,92,255,0.5);'
        . 'display:inline-flex;align-items:center;gap:6px;'
        . 'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;'
        . '">📅 Meine Events</a>';
});

add_shortcode('gsim_organizer_form', function () {
    if (!is_user_logged_in()) {
        return '<div class="gsim-notice" style="padding:20px;background:#fff3cd;border-left:4px solid #ffc107;border-radius:6px;"><p><strong>Login erforderlich.</strong> <a href="' . esc_url(wp_login_url(get_permalink())) . '">Hier einloggen</a> um Events anzulegen. Noch kein Account? <a href="/veranstalter-werden">Event-Hosting-Paket buchen</a>.</p></div>';
    }
    $user = wp_get_current_user();
    if (!in_array(GSIM_EVENTS_ROLE, (array) $user->roles) && !user_can($user, 'manage_options')) {
        return '<div class="gsim-notice" style="padding:20px;background:#fff3cd;border-left:4px solid #ffc107;border-radius:6px;"><p>Dein Account hat keine Veranstalter-Rolle. Bitte erst <a href="/veranstalter-werden">Event-Hosting-Paket buchen</a>.</p></div>';
    }

    $editing_id = isset($_GET['edit']) ? (int) $_GET['edit'] : 0;
    $editing    = null;
    if ($editing_id) {
        $e = get_post($editing_id);
        if ($e && $e->post_type === 'tribe_events' && ($e->post_author == $user->ID || user_can($user, 'manage_options'))) {
            $editing = $e;
        }
    }

    $notice = '';

    // Delete-Handling (?delete=ID&_gsim_nonce=...)
    if (!empty($_GET['delete']) && wp_verify_nonce($_GET['_gsim_nonce'] ?? '', 'gsim_delete_' . (int) $_GET['delete'])) {
        $del_id = (int) $_GET['delete'];
        $e = get_post($del_id);
        if ($e && $e->post_type === 'tribe_events' && ($e->post_author == $user->ID || user_can($user, 'manage_options'))) {
            wp_delete_post($del_id, true);
            $notice = '<div style="padding:12px;background:#f8d7da;border-left:4px solid #dc3545;border-radius:6px;margin-bottom:20px">Event geloescht.</div>';
        }
    }

    // Submit-Handling (create or update)
    if (!empty($_POST['gsim_submit_event']) && wp_verify_nonce($_POST['_gsim_nonce'] ?? '', 'gsim_new_event')) {
        if (!function_exists('tribe_create_event')) {
            $notice = '<div style="color:#900">The Events Calendar ist nicht aktiv.</div>';
        } else {
            $post_id = (int) ($_POST['gsim_event_id'] ?? 0);
            $title = sanitize_text_field($_POST['gsim_title'] ?? '');
            $desc  = wp_kses_post($_POST['gsim_description'] ?? '');
            $start = sanitize_text_field($_POST['gsim_start'] ?? '');
            $end   = sanitize_text_field($_POST['gsim_end'] ?? '');
            if (!$title || !$start || !$end) {
                $notice = '<div style="color:#900">Titel, Start und Ende sind Pflichtfelder.</div>';
            } elseif ($post_id) {
                // Update
                $e = get_post($post_id);
                if ($e && $e->post_type === 'tribe_events' && ($e->post_author == $user->ID || user_can($user, 'manage_options'))) {
                    $vis_in = ($_POST['gsim_visibility'] ?? 'public') === 'private' ? 'private' : 'public';
                    update_post_meta($post_id, GSIM_EVENTS_META_VISIBILITY, $vis_in);
                    if (function_exists('tribe_update_event')) {
                        tribe_update_event($post_id, [
                            'post_title'     => $title,
                            'post_content'   => $desc,
                            'EventStartDate' => date('Y-m-d H:i:s', strtotime($start)),
                            'EventEndDate'   => date('Y-m-d H:i:s', strtotime($end)),
                            'EventTimezone'  => wp_timezone_string(),
                        ]);
                    } else {
                        wp_update_post([
                            'ID' => $post_id, 'post_title' => $title, 'post_content' => $desc,
                        ]);
                    }
                    if (!empty($_FILES['gsim_image']['name'])) {
                        require_once ABSPATH . 'wp-admin/includes/file.php';
                        require_once ABSPATH . 'wp-admin/includes/media.php';
                        require_once ABSPATH . 'wp-admin/includes/image.php';
                        $attachment_id = media_handle_upload('gsim_image', $post_id);
                        if (!is_wp_error($attachment_id)) set_post_thumbnail($post_id, $attachment_id);
                    }
                    $notice = sprintf('<div style="padding:12px;background:#d4edda;border-left:4px solid #28a745;border-radius:6px;margin-bottom:20px">Event aktualisiert. <a href="%s">Ansehen</a></div>', esc_url(get_permalink($post_id)));
                    // Nach Update zurueck zur Liste (kein edit-Modus)
                    $editing = null;
                }
            } else {
                // Create
                $event_id = tribe_create_event([
                    'post_title'     => $title,
                    'post_content'   => $desc,
                    'post_status'    => 'publish',
                    'post_author'    => $user->ID,
                    'EventStartDate' => date('Y-m-d H:i:s', strtotime($start)),
                    'EventEndDate'   => date('Y-m-d H:i:s', strtotime($end)),
                    'EventTimezone'  => wp_timezone_string(),
                ]);
                if ($event_id && !is_wp_error($event_id)) {
                    $vis_in = ($_POST['gsim_visibility'] ?? 'public') === 'private' ? 'private' : 'public';
                    update_post_meta($event_id, GSIM_EVENTS_META_VISIBILITY, $vis_in);
                    if (!empty($_FILES['gsim_image']['name'])) {
                        require_once ABSPATH . 'wp-admin/includes/file.php';
                        require_once ABSPATH . 'wp-admin/includes/media.php';
                        require_once ABSPATH . 'wp-admin/includes/image.php';
                        $attachment_id = media_handle_upload('gsim_image', $event_id);
                        if (!is_wp_error($attachment_id)) set_post_thumbnail($event_id, $attachment_id);
                    }
                    $pass = get_post_meta($event_id, GSIM_EVENTS_META_PASSPHRASE, true);
                    $notice = sprintf(
                        '<div style="padding:16px;background:#d4edda;border-left:4px solid #28a745;border-radius:6px;margin-bottom:20px"><strong>Event angelegt!</strong><br>Passphrase: <code>%s</code><br>Join-Link: <code>%s</code><br><a href="%s">Event ansehen</a></div>',
                        esc_html($pass),
                        esc_html(get_post_meta($event_id, GSIM_EVENTS_META_JOIN_URL, true)),
                        esc_url(get_permalink($event_id))
                    );
                } else {
                    $notice = '<div style="color:#900">Fehler beim Anlegen des Events.</div>';
                }
            }
        }
    }

    // Eigene Events (nach etwaigen Mutationen neu laden)
    $own_events = get_posts([
        'post_type'   => 'tribe_events',
        'numberposts' => 50,
        'author'      => $user->ID,
        'post_status' => ['publish', 'draft', 'future'],
        'orderby'     => 'date',
        'order'       => 'DESC',
    ]);

    ob_start();
    ?>
    <style>
      .gsim-form { max-width:800px; }
      .gsim-form label { display:block; margin-top:14px; font-weight:600; }
      .gsim-form input[type="text"],
      .gsim-form input[type="datetime-local"] { width:100%; padding:8px; border:1px solid #ccc; border-radius:6px; box-sizing:border-box; }
      .gsim-form input[type="file"] { margin-top:4px; }
      .gsim-form button.gsim-btn { margin-top:20px; padding:10px 24px; background:#2f5cff; color:#fff; border:0; border-radius:6px; font-weight:600; cursor:pointer; }
      .gsim-events-list { margin-top:40px; border-top:1px solid #eee; padding-top:20px; }
      .gsim-event-row { padding:10px 0; border-bottom:1px solid #f2f2f2; display:flex; justify-content:space-between; align-items:center; gap:10px; }
      .gsim-event-row .title { font-weight:600; }
      .gsim-event-row code { font-size:12px; color:#666; }
    </style>
    <?php
      // Pre-fill bei Edit-Modus
      $f_title = $editing ? $editing->post_title                                    : '';
      $f_desc  = $editing ? $editing->post_content                                  : '';
      $f_start = $editing ? get_post_meta($editing->ID, '_EventStartDate', true)    : '';
      $f_end   = $editing ? get_post_meta($editing->ID, '_EventEndDate',   true)    : '';
      // DATETIME from MySQL has space, HTML input needs "T"
      $to_input = function ($s) { return $s ? str_replace(' ', 'T', substr($s,0,16)) : ''; };
    ?>
    <div class="gsim-form">
      <h2><?php echo $editing ? 'Event bearbeiten: ' . esc_html($editing->post_title) : 'Neues Event anlegen'; ?></h2>
      <?php echo $notice; ?>
      <form method="post" enctype="multipart/form-data">
        <?php wp_nonce_field('gsim_new_event', '_gsim_nonce'); ?>
        <?php if ($editing): ?>
          <input type="hidden" name="gsim_event_id" value="<?php echo (int) $editing->ID; ?>">
        <?php endif; ?>

        <label for="gsim_title">Titel *</label>
        <input type="text" name="gsim_title" id="gsim_title" required maxlength="200" value="<?php echo esc_attr($f_title); ?>">

        <label for="gsim_description">Beschreibung</label>
        <?php
          wp_editor($f_desc, 'gsim_description', [
            'textarea_name' => 'gsim_description',
            'textarea_rows' => 10,
            'media_buttons' => true,
            'teeny'         => false,
            'tinymce'       => ['toolbar1' => 'bold,italic,underline,bullist,numlist,link,unlink,hr,undo,redo'],
          ]);
        ?>

        <label for="gsim_start">Start *</label>
        <input type="datetime-local" name="gsim_start" id="gsim_start" required value="<?php echo esc_attr($to_input($f_start)); ?>">

        <label for="gsim_end">Ende *</label>
        <input type="datetime-local" name="gsim_end" id="gsim_end" required value="<?php echo esc_attr($to_input($f_end)); ?>">

        <label>Sichtbarkeit</label>
        <?php
          $vis = $editing ? (get_post_meta($editing->ID, GSIM_EVENTS_META_VISIBILITY, true) ?: 'public') : 'public';
        ?>
        <div style="display:flex;gap:16px;margin-top:6px">
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer">
            <input type="radio" name="gsim_visibility" value="public" <?php checked($vis, 'public'); ?>>
            <strong>Oeffentlich</strong> — erscheint im Kalender auf gsimulations.de/events
          </label>
        </div>
        <div style="display:flex;gap:16px;margin-top:4px">
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer">
            <input type="radio" name="gsim_visibility" value="private" <?php checked($vis, 'private'); ?>>
            <strong>Privat</strong> — nur per Direkt-Link erreichbar, nicht im Kalender
          </label>
        </div>

        <label for="gsim_image" style="margin-top:20px">Event-Bild <?php echo $editing ? '(optional ersetzen)' : '(optional)'; ?></label>
        <?php if ($editing && has_post_thumbnail($editing->ID)): ?>
          <div style="margin-bottom:6px;"><?php echo get_the_post_thumbnail($editing->ID, 'medium', ['style'=>'max-height:120px;border-radius:6px']); ?></div>
        <?php endif; ?>
        <input type="file" name="gsim_image" id="gsim_image" accept="image/*">

        <button type="submit" name="gsim_submit_event" value="1" class="gsim-btn"><?php echo $editing ? 'Aenderungen speichern' : 'Event veroeffentlichen'; ?></button>
        <?php if ($editing): ?>
          <a href="<?php echo esc_url(get_permalink()); ?>" style="margin-left:10px;color:#666">Abbrechen</a>
        <?php endif; ?>
      </form>

      <?php if ($own_events): ?>
      <div class="gsim-events-list">
        <h3>Deine Events</h3>
        <?php foreach ($own_events as $ev):
          $pass = get_post_meta($ev->ID, GSIM_EVENTS_META_PASSPHRASE, true);
          $join = get_post_meta($ev->ID, GSIM_EVENTS_META_JOIN_URL, true);
          $atts = (new WP_Query([
              'post_type' => GSIM_EVENTS_CPT_ATTENDEE, 'meta_key' => '_event_id',
              'meta_value' => $ev->ID, 'post_status' => 'publish', 'fields' => 'ids', 'nopaging' => true,
          ]))->found_posts;
        ?>
          <?php $invite_url = home_url('/join/' . rawurlencode($pass)); ?>
          <div class="gsim-event-row">
            <div style="flex:1;min-width:0">
              <div class="title"><?php echo esc_html($ev->post_title); ?> <span style="color:#999;font-weight:400;font-size:12px">— <?php echo esc_html($ev->post_status); ?></span></div>
              <div style="margin-top:6px;font-size:12px;color:#444">
                <strong>Einladungs-Link</strong> (zum Teilen in Stream-Chat, Twitter, Discord):<br>
                <input type="text" value="<?php echo esc_attr($invite_url); ?>" readonly
                       onclick="this.select();document.execCommand('copy');this.nextSibling.textContent='✓ kopiert';"
                       style="width:100%;padding:6px;font-family:ui-monospace,monospace;font-size:12px;border:1px solid #ddd;border-radius:4px">
                <span style="color:#28a745;font-size:11px;margin-left:4px"></span>
              </div>
              <div style="font-size:12px;color:#666;margin-top:4px"><?php echo (int) $atts; ?> Teilnehmer · Passphrase: <code><?php echo esc_html($pass); ?></code></div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <a href="<?php echo esc_url(add_query_arg('edit', $ev->ID, get_permalink())); ?>" style="padding:6px 12px;border:1px solid #ccc;border-radius:6px;text-decoration:none;color:#333">Editieren</a>
              <a href="<?php echo esc_url(get_permalink($ev->ID)); ?>" style="padding:6px 12px;background:#2f5cff;color:#fff;border-radius:6px;text-decoration:none">Ansehen</a>
              <?php $del_nonce = wp_create_nonce('gsim_delete_' . $ev->ID); ?>
              <a href="<?php echo esc_url(add_query_arg(['delete' => $ev->ID, '_gsim_nonce' => $del_nonce], get_permalink())); ?>"
                 onclick="return confirm('Event wirklich loeschen? Teilnehmer-Daten bleiben erhalten.');"
                 style="padding:6px 12px;border:1px solid #dc3545;color:#dc3545;border-radius:6px;text-decoration:none">Loeschen</a>
            </div>
          </div>
        <?php endforeach; ?>
      </div>
      <?php endif; ?>
    </div>
    <?php
    return ob_get_clean();
});

// -----------------------------------------------------------------------------
// Public Invite Landing: /join/<passphrase>
// Oeffentlich teilbarer Link den Streamer/Veranstalter in Chats/Overlays posten.
// Zeigt Event-Info + App-Install-CTA + "Event beitreten"-Button.
// -----------------------------------------------------------------------------

add_action('init', function () {
    add_rewrite_rule('^join/([^/]+)/?$', 'index.php?gsim_join_pass=$matches[1]', 'top');
});

add_filter('query_vars', function ($vars) {
    $vars[] = 'gsim_join_pass';
    return $vars;
});

add_action('template_redirect', function () {
    $pass = get_query_var('gsim_join_pass');
    if (!$pass) return;

    // Event per Passphrase finden
    $events = get_posts([
        'post_type'   => 'tribe_events',
        'numberposts' => 1,
        'post_status' => 'publish',
        'meta_key'    => GSIM_EVENTS_META_PASSPHRASE,
        'meta_value'  => $pass,
    ]);
    $event = $events[0] ?? null;
    $join_url = GSIM_EVENTS_APP_URL . '/?join=' . rawurlencode($pass);
    $install_url = home_url('/msfsvoicewalker');

    $title = $event ? esc_html($event->post_title) : 'MSFSVoiceWalker Event';
    $desc_html = $event ? apply_filters('the_content', $event->post_content) : '';
    $start = $event && function_exists('tribe_get_start_date') ? tribe_get_start_date($event->ID, true, 'd.m.Y H:i') : '';
    $img   = $event && has_post_thumbnail($event->ID) ? get_the_post_thumbnail_url($event->ID, 'large') : '';
    $event_url = $event ? get_permalink($event->ID) : '';

    // Minimales HTML — bewusst ohne Theme-Template, damit Streamer-Browser + Overlays
    // schlanke Seite bekommen. Theme-Styling via get_stylesheet_uri() optional mitgeladen.
    nocache_headers();
    header('Content-Type: text/html; charset=utf-8');
    ?><!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title><?php echo $title; ?> — Join via MSFSVoiceWalker</title>
<link rel="stylesheet" href="<?php echo esc_url(get_stylesheet_uri()); ?>">
<style>
  body { margin:0; background:#0b1220; color:#eaf0ff; font-family:"Segoe UI",system-ui,sans-serif; }
  .wrap { max-width:640px; margin:40px auto; padding:24px; }
  .card { background:#15213a; border:1px solid #233457; border-radius:12px; overflow:hidden; }
  .hero { background-size:cover; background-position:center; min-height:220px; display:flex; align-items:flex-end; padding:20px; background-color:#152040; }
  .hero h1 { margin:0; font-size:26px; text-shadow:0 2px 10px rgba(0,0,0,0.8); }
  .body { padding:24px; }
  .meta { color:#8696b8; font-size:14px; margin-bottom:16px; }
  .desc { line-height:1.55; }
  .desc p { margin:0 0 10px 0; }
  .btn { display:inline-block; padding:14px 22px; border-radius:10px; background:#6aa5ff; color:#0b1220; font-weight:700; text-decoration:none; margin-top:20px; margin-right:10px; }
  .btn.secondary { background:transparent; color:#6aa5ff; border:1px solid #6aa5ff; }
  .passphrase { background:#0b1220; padding:10px 14px; border-radius:6px; font-family:ui-monospace,monospace; display:inline-block; margin-top:10px; }
  .steps { background:#0f1729; padding:16px; border-radius:8px; margin-top:16px; font-size:13px; color:#b5c3dd; }
  .steps ol { margin:0; padding-left:20px; }
  footer { text-align:center; margin-top:24px; color:#8696b8; font-size:12px; }
  .notfound { padding:30px; text-align:center; color:#ff9999; }
</style>
</head>
<body>
<div class="wrap">
<?php if (!$event): ?>
  <div class="card"><div class="notfound">
    <h2>Event nicht gefunden</h2>
    <p>Die Passphrase <code><?php echo esc_html($pass); ?></code> gehoert zu keinem aktiven Event.</p>
    <p>Vielleicht ist das Event schon vorbei oder der Link ist falsch. Teilnehmer mit Pro-Lizenz koennen die Passphrase auch manuell in der App unter "Privater Raum" eintragen.</p>
  </div></div>
<?php else: ?>
  <div class="card">
    <div class="hero" style="<?php if ($img) echo 'background-image:url(' . esc_url($img) . ');'; ?>">
      <h1><?php echo $title; ?></h1>
    </div>
    <div class="body">
      <?php if ($start): ?><div class="meta">📅 <?php echo esc_html($start); ?></div><?php endif; ?>
      <div class="desc"><?php echo wp_kses_post($desc_html); ?></div>

      <a href="<?php echo esc_url($join_url); ?>" class="btn">▶ Jetzt beitreten</a>
      <a href="<?php echo esc_url($install_url); ?>" class="btn secondary">MSFSVoiceWalker installieren</a>

      <div class="steps">
        <strong>So machst du mit:</strong>
        <ol>
          <li>MSFSVoiceWalker installieren (falls noch nicht geschehen)</li>
          <li>MSFS starten, App laeuft automatisch mit</li>
          <li>Oben auf "▶ Jetzt beitreten" klicken</li>
          <li>Du landest im privaten Event-Raum mit allen Teilnehmern</li>
        </ol>
        <p style="margin-top:10px">Passphrase zum manuellen Eintragen: <span class="passphrase"><?php echo esc_html($pass); ?></span></p>
      </div>
    </div>
  </div>
  <footer>
    Hosted on <a href="https://www.gsimulations.de/msfsvoicewalker" style="color:#8696b8">gsimulations.de</a> ·
    <a href="<?php echo esc_url($event_url); ?>" style="color:#8696b8">Event-Details</a>
  </footer>
<?php endif; ?>
</div>
</body>
</html>
    <?php
    exit;
});

// Beim Plugin-Aktivierung rewrite rules flushen (Einmaligkeit via option-check)
register_activation_hook(__FILE__, function () {
    // Flush already in main activation hook above, this is safety
    flush_rewrite_rules();
});

// -----------------------------------------------------------------------------
// Admin-Seite: Veranstalter verwalten (nur fuer Admins)
// wp-admin → Veranstaltungen → Organizer
// -----------------------------------------------------------------------------

add_action('admin_menu', function () {
    add_submenu_page(
        'edit.php?post_type=tribe_events',
        'Organizer verwalten',
        'Organizer',
        'manage_options',
        'gsim-organizers',
        'gsim_render_organizers_page'
    );
});

function gsim_render_organizers_page() {
    if (!current_user_can('manage_options')) wp_die('Keine Berechtigung.');

    // Actions
    $notice = '';
    if (!empty($_POST['gsim_add_organizer']) && check_admin_referer('gsim_organizer_action')) {
        $email = sanitize_email($_POST['email'] ?? '');
        $u = $email ? get_user_by('email', $email) : null;
        if ($u) {
            $role = new WP_User($u->ID);
            if (!in_array(GSIM_EVENTS_ROLE, (array) $u->roles)) {
                $role->add_role(GSIM_EVENTS_ROLE);
                $notice = 'User <strong>' . esc_html($u->user_login) . '</strong> ist jetzt Event-Organizer.';
            } else {
                $notice = 'User hat die Rolle bereits.';
            }
        } else {
            $notice = 'Kein User mit dieser E-Mail gefunden.';
        }
    }
    if (!empty($_POST['gsim_remove_organizer']) && check_admin_referer('gsim_organizer_action')) {
        $uid = (int) $_POST['user_id'];
        $u = get_user_by('id', $uid);
        if ($u && $uid !== get_current_user_id()) {
            $role = new WP_User($uid);
            $role->remove_role(GSIM_EVENTS_ROLE);
            $notice = 'Organizer-Rolle von <strong>' . esc_html($u->user_login) . '</strong> entfernt.';
        }
    }
    if (!empty($_POST['gsim_self_grant']) && check_admin_referer('gsim_organizer_action')) {
        $me = new WP_User(get_current_user_id());
        if (!in_array(GSIM_EVENTS_ROLE, (array) $me->roles)) {
            $me->add_role(GSIM_EVENTS_ROLE);
            $notice = 'Du hast dir selbst die Event-Organizer-Rolle gegeben (zusätzlich zu Admin).';
        }
    }

    // Liste aller Organizer
    $organizers = get_users(['role' => GSIM_EVENTS_ROLE, 'orderby' => 'registered', 'order' => 'DESC']);

    ?>
    <div class="wrap">
      <h1>Event-Organizer verwalten</h1>

      <?php if ($notice): ?>
        <div class="notice notice-success is-dismissible"><p><?php echo $notice; ?></p></div>
      <?php endif; ?>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px">

        <div class="card" style="padding:16px;background:#fff;border:1px solid #ccd0d4;border-radius:4px">
          <h2 style="margin-top:0">Dich selbst zum Organizer machen</h2>
          <p>Als Admin kannst du dir die Rolle geben, um selbst Events zu testen/anlegen.</p>
          <?php $me = wp_get_current_user(); $is_org = in_array(GSIM_EVENTS_ROLE, (array)$me->roles); ?>
          <?php if ($is_org): ?>
            <p style="color:#28a745;font-weight:600">✓ Du bist bereits Event-Organizer</p>
          <?php else: ?>
            <form method="post">
              <?php wp_nonce_field('gsim_organizer_action'); ?>
              <button type="submit" name="gsim_self_grant" value="1" class="button button-primary">
                Mir die Organizer-Rolle geben
              </button>
            </form>
          <?php endif; ?>
        </div>

        <div class="card" style="padding:16px;background:#fff;border:1px solid #ccd0d4;border-radius:4px">
          <h2 style="margin-top:0">User manuell zum Organizer machen</h2>
          <p>E-Mail eines existierenden Users eingeben (der muss vorher schon einen WP-Account haben).</p>
          <form method="post">
            <?php wp_nonce_field('gsim_organizer_action'); ?>
            <input type="email" name="email" placeholder="user@example.com" style="width:100%;margin-bottom:8px">
            <button type="submit" name="gsim_add_organizer" value="1" class="button button-primary">
              Rolle hinzufügen
            </button>
          </form>
        </div>
      </div>

      <h2 style="margin-top:30px">Aktuelle Organizer (<?php echo count($organizers); ?>)</h2>

      <?php if (empty($organizers)): ?>
        <p style="color:#666"><em>Noch keine Organizer. Der erste Kauf von Produkt #975 oder eine manuelle Zuweisung erzeugt einen.</em></p>
      <?php else: ?>
        <table class="wp-list-table widefat fixed striped" style="margin-top:10px">
          <thead>
            <tr>
              <th>User</th><th>E-Mail</th><th>Events</th><th>Registriert</th><th>Aktion</th>
            </tr>
          </thead>
          <tbody>
          <?php foreach ($organizers as $u):
            $event_count = count(get_posts([
                'post_type' => 'tribe_events', 'numberposts' => -1, 'author' => $u->ID,
                'post_status' => ['publish','draft','future'], 'fields' => 'ids',
            ]));
          ?>
            <tr>
              <td>
                <strong><?php echo esc_html($u->display_name ?: $u->user_login); ?></strong>
                <div style="color:#999;font-size:12px">@<?php echo esc_html($u->user_login); ?> (ID <?php echo $u->ID; ?>)</div>
              </td>
              <td><?php echo esc_html($u->user_email); ?></td>
              <td>
                <?php echo $event_count; ?>
                <?php if ($event_count): ?>
                  <a href="<?php echo admin_url('edit.php?post_type=tribe_events&author=' . $u->ID); ?>" style="font-size:12px">ansehen</a>
                <?php endif; ?>
              </td>
              <td><?php echo esc_html(mysql2date('d.m.Y', $u->user_registered)); ?></td>
              <td>
                <?php if ($u->ID !== get_current_user_id()): ?>
                <form method="post" style="display:inline"
                      onsubmit="return confirm('Rolle wirklich entfernen? User bleibt existieren, kann aber keine Events mehr anlegen.');">
                  <?php wp_nonce_field('gsim_organizer_action'); ?>
                  <input type="hidden" name="user_id" value="<?php echo $u->ID; ?>">
                  <button type="submit" name="gsim_remove_organizer" value="1" class="button button-small">Rolle entfernen</button>
                </form>
                <?php else: ?>
                  <span style="color:#999">(du)</span>
                <?php endif; ?>
              </td>
            </tr>
          <?php endforeach; ?>
          </tbody>
        </table>
      <?php endif; ?>
    </div>
    <?php
}

// -----------------------------------------------------------------------------
// Private Events: aus TEC-Listen/Kalender filtern (sichtbar nur ueber Direkt-Link)
// -----------------------------------------------------------------------------

add_action('pre_get_posts', function ($q) {
    if (is_admin())                                      return;
    if (!$q->is_main_query())                            return;
    // Betrifft TEC-Listen/Kalender/Tag-Seiten, NICHT Single-Event
    $is_tec_list = (function_exists('tribe_is_event_query') && tribe_is_event_query() && !is_singular('tribe_events'))
                   || is_post_type_archive('tribe_events')
                   || is_tax('tribe_events_cat');
    if (!$is_tec_list) return;
    $mq = (array) $q->get('meta_query');
    $mq[] = [
        'relation' => 'OR',
        [ 'key' => GSIM_EVENTS_META_VISIBILITY, 'value' => 'private', 'compare' => '!=' ],
        [ 'key' => GSIM_EVENTS_META_VISIBILITY, 'compare' => 'NOT EXISTS' ],
    ];
    $q->set('meta_query', $mq);
});

// Auch die public REST-Liste respektiert die Sichtbarkeit
add_filter('rest_tribe_events_query', function ($args, $request) {
    if (!is_user_logged_in() || !current_user_can('manage_options')) {
        $args['meta_query'] = $args['meta_query'] ?? [];
        $args['meta_query'][] = [
            'relation' => 'OR',
            [ 'key' => GSIM_EVENTS_META_VISIBILITY, 'value' => 'private', 'compare' => '!=' ],
            [ 'key' => GSIM_EVENTS_META_VISIBILITY, 'compare' => 'NOT EXISTS' ],
        ];
    }
    return $args;
}, 10, 2);

// Auch die gsim-events/v1-Liste filtern: siehe shape_event. Wir filtern hier via
// modify-query innerhalb der list-Callback ist einfacher — dazu nutzen wir den
// gleichen meta_query-Trick in der listEvents-Callback. (Redundanz, aber sicher.)

// -----------------------------------------------------------------------------
// Minimal-Styling: NUR den Join-CTA unter Single-Events. Keine Theme-Override
// (TEC-v6 hat zu viele interne Layout-Abhaengigkeiten die !important-Regeln
// durcheinanderbringen — stattdessen lassen wir TEC nativ rendern).
// -----------------------------------------------------------------------------

// Ein paar gezielte TEC-Fixes fuers Dark-Theme (keine Komplett-Uebernahme,
// nur sichtbare Glitches wegmachen)
add_action('wp_head', function () {
    $is_tec = (function_exists('tribe_is_event_query') && tribe_is_event_query())
              || is_singular('tribe_events')
              || is_post_type_archive('tribe_events')
              || is_tax('tribe_events_cat');
    if (!$is_tec) return;
    ?>
    <style id="gsim-tec-fixes">
      /* Dark Background für alle TEC-Views + lesbare Texte */
      .tribe-events-view,
      .tribe-events-calendar-list,
      .tribe-events-calendar-month,
      .tribe-events-calendar-day,
      .tribe-events-single,
      .tribe-events-c-view-selector,
      .tribe-events-c-view-selector__content,
      .tribe-events-c-top-bar,
      .tribe-events-header,
      .tribe-events-c-search,
      .tribe-events-c-search__wrapper {
        background: transparent !important;
      }
      .tribe-events-view * {
        color: #eaf0ff !important;
      }
      .tribe-events-view a,
      .tribe-events-view .tribe-common-anchor-alt {
        color: #6aa5ff !important;
      }
      .tribe-events-view .tribe-events-c-search__input,
      .tribe-events-view input[type="search"],
      .tribe-events-view input[type="text"] {
        background: #15213a !important;
        color: #eaf0ff !important;
        border: 1px solid rgba(106,165,255,0.2) !important;
      }
      .tribe-events-view .tribe-events-c-search__button,
      .tribe-events-view .tribe-events-button {
        background: #6aa5ff !important;
        color: #0b1220 !important;
      }
      /* "Kalender abonnieren" komplett ausblenden — überlappt sonst Pagination */
      .tribe-events-c-subscribe-dropdown,
      .tribe-events-c-subscribe-dropdown__container,
      .tribe-events-c-subscribe-dropdown__wrapper {
        display: none !important;
      }
      /* Event-Cards */
      .tribe-events-calendar-list__event-row,
      .tribe-events-calendar-list__event {
        background: #15213a !important;
        border: 1px solid rgba(106,165,255,0.2) !important;
        border-radius: 10px !important;
        padding: 16px !important;
      }
    </style>
    <?php
});

add_action('wp_head', function () {
    if (!is_singular('tribe_events')) return;
    ?>
    <style id="gsim-tec-style">
      /* Nur der Join-CTA unter Single Events. Keine TEC-Overrides mehr. */
      .gsim-event-cta {
        margin: 30px 0;
        padding: 24px;
        background: linear-gradient(135deg, #15213a 0%, #1a2a4a 100%);
        border: 1px solid #6aa5ff;
        border-radius: 12px;
        text-align: center;
        color: #eaf0ff;
      }
      .gsim-event-cta * { color: #eaf0ff; }
      .gsim-event-cta .btn-join {
        display: inline-block;
        padding: 14px 28px;
        background: #6aa5ff;
        color: #0b1220 !important;
        font-weight: 700;
        border-radius: 10px;
        text-decoration: none;
        font-size: 15px;
        box-shadow: 0 4px 16px rgba(47,92,255,0.3);
      }
      .gsim-event-cta .btn-join:hover { background: #8ab8ff; }
      .gsim-event-cta .btn-secondary {
        color: #8696b8 !important;
        margin-left: 12px;
        font-size: 13px;
        text-decoration: none;
      }
      .gsim-event-cta .passphrase {
        font-family: ui-monospace, SFMono-Regular, monospace;
        background: #0b1220;
        padding: 4px 10px;
        border-radius: 6px;
        color: #6aa5ff !important;
        font-size: 14px;
      }
    </style>
    <?php
});

// Single-Event: Automatisch den Join-CTA unter den Content einfuegen
add_filter('the_content', function ($content) {
    if (!is_singular('tribe_events') || !in_the_loop() || !is_main_query()) return $content;
    $id = get_the_ID();
    $pass = get_post_meta($id, GSIM_EVENTS_META_PASSPHRASE, true);
    $join = get_post_meta($id, GSIM_EVENTS_META_JOIN_URL, true);
    if (!$pass) return $content;
    $invite_url = home_url('/join/' . rawurlencode($pass));
    $cta  = '<div class="gsim-event-cta">';
    $cta .= '<p style="margin:0 0 14px 0;color:#8696b8;font-size:13px;text-transform:uppercase;letter-spacing:1px">Mitmachen</p>';
    $cta .= '<a href="' . esc_url($join) . '" class="btn-join">▶ Event beitreten</a>';
    $cta .= '<a href="' . esc_url($invite_url) . '" class="btn-secondary">Teilen-Link</a>';
    $cta .= '<p style="margin:16px 0 0 0;color:#8696b8;font-size:13px">Passphrase: <span class="passphrase">' . esc_html($pass) . '</span></p>';
    $cta .= '<p style="margin:10px 0 0 0;color:#8696b8;font-size:12px">MSFSVoiceWalker muss installiert und gestartet sein — <a href="' . esc_url(home_url('/msfsvoicewalker')) . '" style="color:#6aa5ff">hier herunterladen</a></p>';
    $cta .= '</div>';
    return $content . $cta;
});

// -----------------------------------------------------------------------------
// Admin-Notice wenn WooCommerce oder TEC fehlt
// -----------------------------------------------------------------------------

add_action('admin_notices', function () {
    $missing = [];
    if (!class_exists('WooCommerce'))       $missing[] = 'WooCommerce';
    if (!class_exists('Tribe__Events__Main')) $missing[] = 'The Events Calendar';
    if ($missing) {
        printf(
            '<div class="notice notice-error"><p><strong>G-Sim Events:</strong> Bitte aktiviere/installiere: %s</p></div>',
            esc_html(implode(', ', $missing))
        );
    }
});
