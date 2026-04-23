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

    // GET /events — Liste öffentlicher Events
    register_rest_route($ns, '/events', [
        'methods'  => 'GET',
        'callback' => function ($req) {
            $args = [
                'post_type'   => 'tribe_events',
                'post_status' => 'publish',
                'numberposts' => min(50, (int) ($req['per_page'] ?? 20)),
                'offset'      => max(0, (int) ($req['offset'] ?? 0)),
                'orderby'     => 'meta_value',
                'meta_key'    => '_EventStartDate',
                'order'       => 'ASC',
            ];
            // Nur zukünftige Events wenn ?upcoming=1
            if (!empty($req['upcoming'])) {
                $args['meta_query'] = [[
                    'key'     => '_EventStartDate',
                    'value'   => current_time('mysql'),
                    'compare' => '>=',
                    'type'    => 'DATETIME',
                ]];
            }
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
// Admin-Bar auf dem Frontend ausblenden fuer Organizer
add_action('after_setup_theme', function () {
    if (!is_user_logged_in()) return;
    $user = wp_get_current_user();
    if (in_array(GSIM_EVENTS_ROLE, (array) $user->roles) && !user_can($user, 'manage_options')) {
        show_admin_bar(false);
    }
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

        <label for="gsim_image">Event-Bild <?php echo $editing ? '(optional ersetzen)' : '(optional)'; ?></label>
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
          <div class="gsim-event-row">
            <div>
              <div class="title"><?php echo esc_html($ev->post_title); ?> <span style="color:#999;font-weight:400;font-size:12px">— <?php echo esc_html($ev->post_status); ?></span></div>
              <div><code><?php echo esc_html($join ?: '—'); ?></code></div>
              <div style="font-size:12px;color:#666;margin-top:2px"><?php echo (int) $atts; ?> Teilnehmer</div>
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
