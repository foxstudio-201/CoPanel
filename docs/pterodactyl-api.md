# Pterodactyl Panel — Client API Reference (for building a panel client)

Compiled from the official Pterodactyl panel source on GitHub, branch **`1.0-develop`**
(fallback `develop` only used where a `1.0-develop` path 404'd), plus the **`wings`** daemon
source on branch **`develop`** for the WebSocket protocol.

Primary sources read:

- `routes/api-client.php`, `routes/api-application.php`, `app/Providers/RouteServiceProvider.php`, `app/Http/Kernel.php`
- `app/Http/Controllers/Api/Client/**` and the matching `app/Http/Requests/Api/Client/**` validation classes
- `app/Transformers/Api/Client/**` and `app/Extensions/League/Fractal/Serializers/PterodactylSerializer.php`
- `app/Exceptions/Handler.php`, `config/http.php`
- `resources/scripts/**` (the official frontend — used to confirm real request/response usage)
- `tests/Integration/Api/Client/**` (used to confirm exact envelope shapes)
- wings: `router/websocket/{message,websocket,listeners}.go`, `router/router_server_ws.go`, `server/events.go`, `server/resources.go`, `environment/stats.go`, `router/router.go`

Anything I could not confirm from source is marked **UNVERIFIED** at the end.

---

## 0. Quick conventions

| Concept | Value |
|---|---|
| Client API base | `https://<panel>/api/client` |
| Application API base | `https://<panel>/api/application` |
| Wings (daemon) base | `https://<node>/api/servers/{uuid}/...` |
| Auth header | `Authorization: Bearer ptlc_...` |
| Accept header | `Accept: application/vnd.pterodactyl.v1+json` |
| Content type | `Content-Type: application/json` (except file write/upload/contents) |
| `{server}` path param | server **UUID** (36), **uuidShort** (8 chars), or `serv_` identifier |
| `{backup}` path param | backup **UUID** |
| `{database}` path param | **Hashids** string (same value as `attributes.id`) |
| `{schedule}` `{task}` `{allocation}` path param | raw integer **id** |
| `{user}` (subuser) path param | target user **UUID** |

Envelope shapes (from `PterodactylSerializer`, confirmed by integration tests):

```jsonc
// item
{ "object": "<resource-name>", "attributes": { ... } }

// collection
{ "object": "list", "data": [ { "object": "...", "attributes": { ... } }, ... ] }

// collection over a paginator adds meta
{ "object": "list", "data": [ ... ],
  "meta": { "pagination": { "total": 1, "count": 1, "per_page": 50,
                           "current_page": 1, "total_pages": 1 } } }

// included relationships are nested INSIDE attributes
{ "object": "server",
  "attributes": { "...": "...",
    "relationships": {
      "egg":       { "object": "egg", "attributes": { ... } },
      "allocations": { "object": "list", "data": [ { "object": "allocation", "attributes": { ... } } ] },
      "variables": { "object": "null_resource", "attributes": null }
    } },
  "meta": { ... } }

// null include
{ "object": "null_resource", "attributes": null }
```

Error envelope (`app/Exceptions/Handler.php`):

```jsonc
{ "errors": [
    { "code": "ValidationException",   // class_basename(exception)
      "status": "422",                 // string!
      "detail": "The given data was invalid.",
      "meta": { "source_field": "name", "rule": "required" }   // validation errors only
    } ] }
```

* `code` is the exception class basename: `ValidationException`, `AuthenticationException`,
  `AccessDeniedHttpException`, `HttpForbiddenException`, `NotFoundHttpException`,
  `BadRequestHttpException`, `DisplayException`, `DaemonConnectionException`, …
* 404 for missing models → `detail: "The requested resource could not be found on the server."`
* Unauthenticated → HTTP 401 with `{"errors":[{"code":"AuthenticationException","status":"401","detail":"Unauthenticated."}]}`
  **only if the request looks like a JSON request** (send an `Accept` containing `+json`/`json`,
  or `X-Requested-With: XMLHttpRequest`), otherwise you get a redirect to `/auth/login`.
* Malformed JSON body → HTTP 400 `{"errors":[{"code":"BadRequestHttpException","status":"400",
  "detail":"The JSON data passed in the request appears to be malformed: ..."}]}` (via `IsValidJson` middleware).
* With `APP_DEBUG=true` the error object additionally carries `source:{line,file}` and `meta:{trace,previous}`.

Rate limiting (Laravel `throttle:api.client`, `config/http.php`):

| Setting | Default |
|---|---|
| Limit | `APP_API_CLIENT_RATELIMIT` = **256 requests / 1 minute** (application API: same, `APP_API_APPLICATION_RATELIMIT`) |
| Bucket key | authenticated user's `uuid` (falls back to client IP) |
| Response headers | `X-RateLimit-Limit`, `X-RateLimit-Remaining` |
| On 429 | `Retry-After` (seconds), `X-RateLimit-Reset` |

---

## 1. Authentication

### Key types (`app/Models/ApiKey.php`)

| Prefix | `key_type` | For | Notes |
|---|---|---|---|
| `ptlc_` | `TYPE_ACCOUNT = 1` | **Client API** `/api/client/*` | Owned by a normal user; scoped by that user's server access + per-server permission grants. |
| `ptla_` | `TYPE_APPLICATION = 2` | **Application API** `/api/application/*` | Requires `root_admin` on the account. |

* Key format: `prefix + 16-char identifier` then the secret; full token = `ptlc_` + 12 random chars + 32 secret chars
  (`IDENTIFIER_LENGTH = 16`, `KEY_LENGTH = 32`).
* **Middleware `RequireClientApiKey`** rejects `ptla_` keys on `/api/client` with HTTP 403:
  *"You are attempting to use an application API key on an endpoint that requires a client API key."*
* **Middleware `AuthenticateApplicationUser`** rejects non-admin accounts on `/api/application` (403).
* **The Application API has no power / console / websocket / file endpoints at all.**
  `routes/api-application.php` only exposes: users, nodes (+node allocations), locations,
  servers (CRUD, details, build, startup, suspend/unsuspend, reinstall, databases, commands
  are absent — there is *no* `/servers/{id}/command`, *no* `/power`, *no* `/websocket`, *no* `/files`).
  Live power state is only observable through the Client API or Wings.
* Both APIs are also behind `auth:sanctum`, `AuthenticateIPAccess` (optional `allowed_ips` on the key),
  and `RequireTwoFactorAuthentication`.

### Recommended headers

```http
Authorization: Bearer ptlc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Accept: application/vnd.pterodactyl.v1+json
Content-Type: application/json
```

> **Note:** I grepped **every** `.php`/`.ts`/`.tsx` file in the `1.0-develop` tree (1268 files) for
> `vnd.pterodactyl`; the only hit is `tests/Integration/Api/Application/ApplicationApiIntegrationTestCase.php`,
> which sets it as a test header. **No middleware enforces this Accept value** — it is a documented
> convention. Its practical effect is that Laravel treats the request as JSON (`wantsJson()` matches
> `+json`), so errors come back as JSON instead of redirects. Sending `Accept: application/json`
> works identically (that's what the official frontend sends).

### Middleware stack for `/api/client` (`Kernel.php` + `RouteServiceProvider.php`)

`EnsureStatefulRequests` → `auth:sanctum` → `IsValidJson` → `TrackAPIKey` →
`RequireTwoFactorAuthentication` → `AuthenticateIPAccess` → `SubstituteClientBindings` →
`RequireClientApiKey` → `throttle:api.client`

---

## 2. Account

### `GET /api/client/account`

No params. Permission: authenticated user (`AccountSubject` middleware).

```jsonc
{
  "object": "user",
  "attributes": {
    "id": 1,                    // int   (DB id)
    "admin": false,             // bool  (root_admin)
    "username": "jdoe",         // string
    "email": "a@b.c",           // string
    "first_name": "Jane",       // string (users.name_first)
    "last_name": "Doe",         // string (users.name_last)
    "language": "en"            // string
  }
}
```

Related account routes (all under `/api/client/account`, bodies not documented in detail here):

| Method | Path | Returns |
|---|---|---|
| GET | `/two-factor` | 2FA QR/secret state |
| POST | `/two-factor` | enable 2FA |
| POST | `/two-factor/disable` | disable 2FA |
| PUT | `/email` | 204; body `{email}` — max **3 changes / 24 h** (429 after) |
| PUT | `/password` | 204; body `{current_password, password, password_confirmation}` |
| GET | `/activity` | paginated activity log |
| GET/POST | `/api-keys` | list / create API keys (memo, allowed_ips, expires_at) |
| DELETE | `/api-keys/{identifier}` | 204 |
| GET/POST | `/ssh-keys` | list / add SSH public keys |
| POST | `/ssh-keys/remove` | body `{key}` |

---

## 3. Servers

### 3.1 `GET /api/client` — list servers

Query parameters:

| Param | Type | Default | Notes |
|---|---|---|---|
| `include` | string | — | comma list; valid values for this transformer: `egg`, `subusers` (plus always-on defaults `allocations`,`variables`) |
| `per_page` | int | `50` | hard-capped at `100` |
| `page` | int | `1` | |
| `type` | string | — | `owner` \| `admin` \| `admin-all` (admin variants require `root_admin`, else empty list) |
| `filter[uuid]`, `filter[name]`, `filter[description]`, `filter[external_id]` | string | — | Spatie QueryBuilder filters |
| `filter[*]` | string | — | custom multi-field filter: matches name/uuid/uuidShort/`ip:port`/`:port` |

Response:

```jsonc
{
  "object": "list",
  "data": [
    { "object": "server", "attributes": { /* see below */ } }
  ],
  "meta": { "pagination": { "total": 1, "count": 1, "per_page": 50,
                            "current_page": 1, "total_pages": 1 } }
}
```

**`ServerTransformer` — exact `attributes`:**

| Field | Type | Notes |
|---|---|---|
| `server_owner` | bool | `true` if *you* own it (computed from the requesting user) |
| `identifier` | string | `uuidShort` (8) **or** `serv_…` identifier depending on `features.new_server_identifiers` |
| `__deprecated_uuid_short` | string | always `uuidShort` |
| `server_identifier` | string | always the `serv_…` identifier |
| `internal_id` | int | |
| `uuid` | string | full UUID (use this for all other endpoints) |
| `name` | string | |
| `node` | string | node FQDN name |
| `is_node_under_maintenance` | bool | |
| `sftp_details` | object | `{ "ip": string(node fqdn), "port": int(node daemonSFTP) }` |
| `description` | string\|null | |
| `limits` | object | `{memory:int, swap:int, disk:int, io:int, cpu:int, threads:int\|null, oom_disabled:bool}` |
| `invocation` | string | rendered startup command; non-viewable variables are masked as `[hidden]` |
| `docker_image` | string | |
| `egg_features` | string[] | `egg.inherit_features` |
| `feature_limits` | object | `{databases:int, allocations:int, backups:int}` |
| `status` | string\|null | `null` normally; `installing` / `restoring_backup` / `suspended` / `transferring` etc. |
| `is_suspended` | bool | **deprecated**, use `status` |
| `is_installing` | bool | **deprecated**, use `status` |
| `is_transferring` | bool | |
| `skip_scripts` | bool | |

**Relationships present by default** (they are `defaultIncludes`, so they appear even without `?include=`):

```jsonc
"relationships": {
  "allocations": { "object": "list", "data": [ { "object": "allocation", "attributes": { ... } } ] },
  "variables":   { "object": "list", "data": [ { "object": "egg_variable", "attributes": { ... } } ] }
  // "variables" is { "object": "null_resource", "attributes": null } without startup.read
}
```

If `?include=egg,subusers`:

```jsonc
"egg":      { "object": "egg", "attributes": { "uuid": "...", "name": "Paper" } },
"subusers": { "object": "list", "data": [ { "object": "server_subuser", "attributes": { ... } } ] }
```

Permission gating of includes:

* `allocations` → without `allocation.read`: only the primary allocation is returned and its `notes` is `null`.
* `variables` → without `startup.read`: `null_resource`.
* `subusers` → without `user.read`: `null_resource`.

### 3.2 `GET /api/client/servers/{server}` — view one server

Same transformer / same `attributes` / same default relationships, plus:

```jsonc
"meta": {
  "is_server_owner": true,
  "user_permissions": ["control.console", "control.start", "websocket.connect", ...]
}
```

`?include=egg,subusers` works here too.

### 3.3 `GET /api/client/servers/{server}/resources`

Permission: any server access. Response is **cached 20 s** panel-side.

```jsonc
{
  "object": "stats",
  "attributes": {
    "current_state": "running",      // string: offline | starting | running | stopping
    "is_suspended": false,           // bool
    "resources": {
      "memory_bytes":   123456,      // int
      "cpu_absolute":   12.34,       // float (percent of *whole* host CPU)
      "disk_bytes":     999,         // int
      "network_rx_bytes": 0,         // int
      "network_tx_bytes": 0,         // int
      "uptime":         123456       // int (ms)
    }
  }
}
```

(`StatsTransformer` defaults every missing key to `0`/`false`/`stopped`, so a partial Wings reply is safe.)

### 3.4 `POST /api/client/servers/{server}/power`

Body:

| Field | Type | Required | Allowed |
|---|---|---|---|
| `signal` | string | ✅ | `start`, `stop`, `restart`, `kill` (=`Task::POWER_ACTIONS`) |

Permission required is derived from the signal: `control.start` / `control.stop` / `control.restart`
(`kill` maps to `control.stop`).
**Response: HTTP `204 No Content`, empty body.**

### 3.5 `POST /api/client/servers/{server}/command`

Body:

| Field | Type | Required |
|---|---|---|
| `command` | string, `min:1` | ✅ |

Permission `control.console`. **HTTP `204`, empty body.**
If Wings answers 502 the panel re-throws HTTP 502
`"Server must be online in order to send commands."`

### 3.6 `GET /api/client/servers/{server}/websocket`

Permission: `websocket.connect`. (Also subject to a node-level "websockets disabled" resource limit.)
Response is **not** a Fractal envelope:

```json
{ "data": { "token": "<jwt>", "socket": "wss://<node-fqdn>/api/servers/<uuid>/ws" } }
```

* JWT expiry = **10 minutes** from issue; claims: `server_uuid`, `permissions[]`, scope `websocket`.
* If the server is being transferred the socket URL points at the **new** node and you must hold
  `admin.websocket.transfer`, else 403.

### 3.7 Settings

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/client/servers/{server}/settings/rename` | `{ "name": string ✅, "description": string\|null }` | **204** |
| POST | `/api/client/servers/{server}/settings/reinstall` | *(empty)* | **202 Accepted**, empty body |
| PUT | `/api/client/servers/{server}/settings/docker-image` | `{ "docker_image": string ✅ }` | **204** |

⚠️ The Docker-image field is **`docker_image`**, not `image`, and the method is **PUT**.
The value must be one of `egg.docker_images`, otherwise HTTP 400
*"This server's Docker image has been manually set by an administrator and cannot be updated."*
Permissions: `settings.rename`, `settings.reinstall`, `startup.docker-image`.

### 3.8 Other server-scoped endpoints (not detailed further)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/client/servers/{server}/activity` | paginated activity log, `activity.read` |

---

## 4. WebSocket protocol (Wings)

Connect to the `socket` URL from §3.6 (plain WebSocket, compressed, Origin must equal the panel's
`PanelLocation` or be in `AllowedOrigins` — otherwise the upgrade fails).

**Framing** — every frame is a JSON *text* message of exactly this shape (wings `router/websocket/message.go`):

```json
{ "event": "<name>", "args": ["<string>", "..."] }
```

`args` is `[]string` with `omitempty`. Wings reads with a 4 KiB *compressed* read limit,
drops non-text frames or frames > 32 768 bytes decompressed, and applies a global rate limit of
10 messages / 200 ms.

### 4.1 Client → server events

| Event | `args` | Behaviour / required permission |
|---|---|---|
| `auth` | `[ "<jwt>" ]` | Wings joins `args` with `""`, parses/validates the JWT (must contain `websocket.connect` + `websocket` scope). Replies `auth success`, then always sends `status` (current state) and — if the server is offline — `stats`. Re-sending `auth` with a fresh JWT on a live socket is the token-refresh flow (it does **not** re-emit `status`). |
| `send logs` | *(ignored — may be omitted or `[null]`)* | Replays the last N container log lines (config `System.WebsocketLogCount`) as individual `console output` events. Ignored if the container isn't running. |
| `send stats` | *(ignored)* | Replies once with a `stats` event. |
| `send command` | `[ "<command line>" ]` | Requires `control.console`; silently ignored if the server is offline / starting-and-not-attached. |
| `set state` | `[ "start" \| "stop" \| "restart" \| "kill" ]` | Mapped to `control.start` / `control.stop` / `control.restart` (kill → `control.stop`). Wings joins `args` with `""`. |

Notes:
* `args` are **joined with an empty string** (`strings.Join(m.Args, "")`), so send exactly one element.
* Any non-`auth` message on an unauthenticated socket gets `jwt error` back.
* Panel's own sender builds `{event, args: [payload]}`, so `send logs`/`send stats` are actually sent as
  `{"event":"send logs","args":[null]}` — Wings ignores `args` for those two, so it works.

### 4.2 Server → client events

| Event | `args[0]` | Notes |
|---|---|---|
| `auth success` | — | authentication accepted |
| `status` | `"offline" \| "starting" \| "running" \| "stopping"` | sent on auth and on every container state change |
| `console output` | `"<line>"` | one log line per message |
| `stats` | **a JSON string** (see below) | on `send stats`, on auth (if offline), and periodically while running |
| `install started` | `""` | |
| `install output` | `"<line>"` | requires JWT permission `admin.websocket.install` |
| `install completed` | `""` | |
| `transfer logs` | `"<line>"` | requires `admin.websocket.transfer` |
| `transfer status` | `"starting" \| "success" \| "failure" \| ...` | status enum string; on anything other than `starting`/`success` the panel reconnects to the new node |
| `backup completed:<uuid>` | JSON string | see below; requires `backup.read` |
| `backup restore completed` | `""` (empty string) | published by `router_server_backup.go` after a local **and** an S3 restore finish; requires `backup.read` |
| `daemon message` | `"<line>"` | e.g. `"(restoring): <file>"`, `"Starting installation process…"` |
| `daemon error` | `"<Error Event [uuid]: message>"` | only the generic message unless JWT has `admin.websocket.errors` |
| `jwt error` | `"jwt: …"` | e.g. `jwt: no jwt present`, `jwt: exp claim is invalid`, `jwt: created too far in past (denylist)`, `jwt: uuid mismatch` |
| `throttled` | `"global"` **or** `"<event name>"` | `"global"` = >10 msgs / 200 ms socket-level limiter (`router_server_ws.go`); an event name = the per-event limiter in `router/websocket/limiter.go` |
| `deleted` | JSON of `nil` (typically `"null"`) | server was deleted (`router_server.go` publishes `DeletedEvent` with `nil` data; the generic listener in `listeners.go` JSON-marshals it). Exact `args[0]` string is **UNVERIFIED** — I did not run Wings to observe it. |
| `token expiring` | — | ≤ 60 s of JWT lifetime left (checked every 30 s) |
| `token expired` | — | JWT past expiry — re-fetch from `GET …/websocket` and re-`auth` |

**`stats` `args[0]` is a JSON *string* — you must `JSON.parse(args[0])`.**
Its fields are the Go `server.ResourceUsage` struct (`environment.Stats` inlined):

```jsonc
{
  "memory_bytes": 0,            // uint64
  "memory_limit_bytes": 0,      // uint64
  "cpu_absolute": 0.0,          // float64
  "network": { "rx_bytes": 0, "tx_bytes": 0 },
  "uptime": 0,                  // int64, ms
  "state": "running",           // *system.AtomicString  (may be null)
  "disk_bytes": 0               // int64
}
```

(The official frontend parses it with `JSON.parse(data)` and reads `cpu_absolute`,
`memory_bytes`, `network.tx_bytes`, `network.rx_bytes`.)

**Backup completed payload** (event name is literally `backup completed:<backup-uuid>`):

```jsonc
{ "uuid": "...", "is_successful": true, "checksum": "…", "checksum_type": "sha1", "file_size": 12345 }
```

### 4.3 Connection limits / close codes

| Code | Meaning |
|---|---|
| `4409` | server is suspended — Wings connects then immediately closes with `"server is suspended"`; **do not reconnect** |
| `4400` | reserved for future use — also do not reconnect |
| HTTP 400 `{"error":"Too many open websocket connections."}` | Wings caps at **30** concurrent sockets per server |

Permissions embedded in the JWT (from the panel's `GetUserPermissionsService`):
`websocket.connect`, `control.console`, `control.start`, `control.stop`, `control.restart`,
`admin.websocket.errors`, `admin.websocket.install`, `admin.websocket.transfer`, `backup.read`.

---

## 5. Files

All under `/api/client/servers/{server}/files`.

⚠️ **Method/body corrections vs. common assumptions:**

* `rename` is **PUT**, not POST.
* Most destructive operations take `{ root, files }`, **not** `{ from, to }` / `{ files }` alone.
* `chmod` takes an **array of `{file, mode}`**, not `{file, mode, recursive}`.
* `write` takes `file` as a **query parameter**; the file bytes are the **raw request body**.

| Method | Path | Permission | Query | Body | Response |
|---|---|---|---|---|---|
| GET | `/list` | `file.read` | `directory` (string, default `/`) | — | list of `file_object` |
| GET | `/contents` | `file.read-content` | `file` (string ✅) | — | **`text/plain` raw file body**, HTTP 200 (413/… if over `files.max_edit_size`) |
| GET | `/download` | `file.read-content` | `file` (string ✅) | — | `{"object":"signed_url","attributes":{"url":"https://<node>/download/file?token=<jwt>"}}` (JWT, 15 min) |
| GET | `/upload` | `file.create` | — | — | `{"object":"signed_url","attributes":{"url":"https://<node>/upload/file?token=<jwt>"}}` (JWT, 15 min) |
| POST | `/write` | `file.create` | `file` (string ✅) | **raw body** (`Content-Type: text/plain`) | 204 |
| **PUT** | `/rename` | `file.update` | — | see below | 204 |
| POST | `/copy` | `file.create` | — | `{ "location": "<destination path>" }` ✅ | 204 |
| POST | `/compress` | `file.archive` | — | `{ "root": "/", "files": ["a.txt"] }` | **single** `file_object` item |
| POST | `/decompress` | `file.create` | — | `{ "root": "/", "file": "a.tar.gz" }` | 204 |
| POST | `/delete` | `file.delete` | — | `{ "root": "/", "files": ["a.txt"] }` | 204 |
| POST | `/create-folder` | `file.create` | — | `{ "root": "/", "name": "newdir" }` | 204 |
| POST | `/chmod` | `file.update` | — | see below | 204 |
| POST | `/pull` | `file.create` | — | `{ "url": "https://…", "directory": "/", "filename": "x", "use_header": false, "foreground": false }` (`url` required+`url` rule; others optional/bool) | 204 |

### Exact bodies

```jsonc
// PUT /files/rename
{ "root": "/",                                    // required, nullable string
  "files": [ { "from": "old.txt", "to": "new.txt" } ] }   // required array of objects

// POST /files/chmod
{ "root": "/",                                    // required, nullable string
  "files": [ { "file": "server.properties", "mode": 755 } ] }  // required; mode is numeric

// POST /files/delete
{ "root": "/", "files": [ "a.txt", "logs" ] }

// POST /files/compress
{ "root": "/", "files": [ "a.txt", "b.txt" ] }    // optional "location" does NOT exist

// POST /files/decompress
{ "root": "/", "file": "a.tar.gz" }
```

### File upload flow (verified end-to-end)

1. `GET /api/client/servers/{uuid}/files/upload` →
   `{"object":"signed_url","attributes":{"url":"https://<node>/upload/file?token=<jwt>"}}`
2. **POST** that URL (Wings route: `router.POST("/upload/file", postServerUploadFiles)`),
   with:
   * `Content-Type: multipart/form-data`
   * form field **`files`** = the file (`{ files: <File> }`)
   * query **`?directory=<current dir>`**
3. Response comes from Wings (errors come back as `{"error":"<string>"}`).
4. Token is valid 15 minutes; the panel frontend fetches a **fresh URL per file**.

(⚠️ the official frontend uses **POST**, not PUT, for the byte transfer.)

### `file_object` — exact attributes (`FileObjectTransformer`)

| Field | Type | Source |
|---|---|---|
| `name` | string | `name` |
| `mode` | string | `mode` (e.g. `drwxr-xr-x`) |
| `mode_bits` | string | `mode_bits` (e.g. `755`) |
| `size` | int | `size` |
| `is_file` | bool | Wings `file` (default `true`) |
| `is_symlink` | bool | Wings `symlink` (default `false`) |
| `mimetype` | string | Wings `mime`, default `application/octet-stream` |
| `created_at` | RFC3339/ISO-8601 string | Wings `created` |
| `modified_at` | RFC3339/ISO-8601 string | Wings `modified` |

> ❌ **`GET /files/list` does NOT return a bare array.** It returns the standard envelope:
> `{"object":"list","data":[{"object":"file_object","attributes":{…}}, …]}`
> (verified: `FileController::directory()` → `$this->fractal->collection(...)`, and the official
> frontend reads `data.data`).
> ❌ There is no `directory`, `type`, `symlinks`, or `absolute_path` field in the response —
> `is_file`/`is_symlink`/`mimetype` are the closest equivalents.

`POST /files/compress` returns an **item**, not a list:
`{"object":"file_object","attributes":{…}}`.

---

## 6. Databases

Base: `/api/client/servers/{server}/databases`

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/` | — | list of `server_database` |
| POST | `/` | see below | **item** with `relationships.password` |
| POST | `/{database}/rotate-password` | *(empty)* | **item** with `relationships.password` |
| DELETE | `/{database}` | *(empty)* | **204** |

Create body (`StoreDatabaseRequest`):

| Field | Type | Required | Rules |
|---|---|---|---|
| `database` | string | ✅ | `alpha_dash`, `min:3`, `max:48`, unique per server |
| `remote` | string | ❌ | DB-host dependent rules (`%` wildcards allowed), i.e. allowed connection sources |

There is **no** `username`/`password` field — they are generated by the panel.

**`DatabaseTransformer` — exact attributes:**

```jsonc
{ "object": "server_database",
  "attributes": {
    "id": "Y5nB3KqR",            // Hashids STRING (also the {database} path param)
    "host": { "address": "10.0.0.1", "port": 3306 },   // object, not scalars
    "name": "sandstorm_abc123",
    "username": "sandstorm_abc123",
    "connections_from": "%",     // NOT "connections_to"
    "max_connections": 100
  },
  "relationships": {
    "password": { "object": "database_password",
                  "attributes": { "password": "plaintext" } }
  } }
```

`relationships.password` is present only on **create** and **rotate-password**, and only if you hold
`database.view_password`; otherwise it is `{"object":"null_resource","attributes":null}`.

Permissions: `database.read` / `database.create` / `database.update` (rotate) / `database.delete`.
A create that would exceed `feature_limits.databases` returns
`Cannot create additional databases on this server: limit has been reached.`

---

## 7. Schedules

Base: `/api/client/servers/{server}/schedules`

| Method | Path | Permission | Body | Response |
|---|---|---|---|---|
| GET | `/` | `schedule.read` | — | list of `server_schedule` |
| POST | `/` | `schedule.create` | see below | item |
| GET | `/{schedule}` | `schedule.read` | — | item |
| POST | `/{schedule}` | `schedule.update` | same as create | item |
| POST | `/{schedule}/execute` | `schedule.update` | *(empty)* | **202**, empty body |
| DELETE | `/{schedule}` | `schedule.delete` | *(empty)* | **204** |
| POST | `/{schedule}/tasks` | `schedule.update` | see task body | item `schedule_task` |
| POST | `/{schedule}/tasks/{task}` | `schedule.update` | same | item |
| DELETE | `/{schedule}/tasks/{task}` | `schedule.update` | *(empty)* | **204** |

`{schedule}` and `{task}` are **raw integer IDs** (not hashes, not UUIDs).

### Schedule create/update body

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | ✅ | `max:191` |
| `minute` | string | ✅ | cron field, validated `required\|string` then evaluated by `CronExpression` |
| `hour` | string | ✅ | |
| `day_of_month` | string | ✅ | |
| `month` | string | ⚠️ **effectively required** | **read by the controller but NOT in the validation rules.** `Utilities::getScheduleNextRunDate()` is typed `string $month`, so omitting it → PHP `TypeError` → HTTP 500. Always send it (e.g. `*`). |
| `day_of_week` | string | ✅ | |
| `is_active` | bool | ✅ (`filled` + `boolean`) | |
| `only_when_online` | bool | ❌ | read as `(bool)`, defaults `false` — not validated |

Invalid cron → HTTP 400/422-ish `DisplayException`:
*"The cron data provided does not evaluate to a valid expression."*
Toggling `is_active` also resets `is_processing` to `false`.

### `ScheduleTransformer` — exact attributes

```jsonc
{ "object": "server_schedule",
  "attributes": {
    "id": 1,                                  // int
    "name": "Daily restart",
    "cron": {                                 // nested object
      "day_of_week": "0",
      "day_of_month": "*",
      "month": "*",
      "hour": "4",
      "minute": "0"
    },
    "is_active": true,                        // bool
    "is_processing": false,                   // bool
    "only_when_online": true,                 // bool
    "last_run_at":  "2024-01-01T04:00:00+00:00",  // ISO-8601 string | null
    "next_run_at":  "2024-01-02T04:00:00+00:00",  // ISO-8601 string | null
    "created_at":   "2023-12-01T00:00:00+00:00",
    "updated_at":   "2023-12-01T00:00:00+00:00"
  },
  "relationships": {                          // "tasks" is a DEFAULT include — always present
    "tasks": { "object": "list", "data": [ { "object": "schedule_task", "attributes": { ... } } ] }
  } }
```

### Task create/update body (`StoreTaskRequest`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `action` | string | ✅ | `command` \| `power` \| `backup` |
| `payload` | string | ✅ unless `action=backup` | for `power` must be one of `start,stop,restart,kill` |
| `time_offset` | int | ✅ | seconds, `0…900` |
| `sequence_id` | int | ❌ (`sometimes`) | `min:1`; if lower than an existing task's, tasks are shifted |
| `continue_on_failure` | bool | ❌ (`sometimes`) | |

Extra rules enforced in the controller: max **10** tasks per schedule
(`client_features.schedules.per_schedule_task_limit`), and a `backup` task is rejected with 403 if
`feature_limits.backups == 0`.
Permission is also derived from the action (`control.console` for command, `backup.create` for backup,
`control.*` for power).

### `TaskTransformer` — exact attributes

```jsonc
{ "object": "schedule_task",
  "attributes": {
    "id": 1,                       // int
    "sequence_id": 1,              // int
    "action": "command",           // command | power | backup
    "payload": "say hi",           // string ("" for backup)
    "time_offset": 0,              // int (seconds)
    "is_queued": false,            // bool
    "continue_on_failure": false,  // bool
    "created_at": "…",             // ISO-8601
    "updated_at": "…"              // ISO-8601
  } }
```

---

## 8. Network / allocations

Base: `/api/client/servers/{server}/network`

| Method | Path | Permission | Body | Response |
|---|---|---|---|---|
| GET | `/allocations` | `allocation.read` | — | list of `allocation` |
| POST | `/allocations` | `allocation.create` | **no fields** (panel auto-picks a free allocation on the node) | item |
| POST | `/allocations/{allocation}` | `allocation.update` | `{ "notes": string\|null }` — `notes` must be **present** (`nullable`, `max:256`) | item |
| POST | `/allocations/{allocation}/primary` | `allocation.update` | *(empty)* | item |
| DELETE | `/allocations/{allocation}` | `allocation.delete` | *(empty)* | **204** |

* There is **no `allocation` or `alias` request field** anywhere. Aliases (`ip_alias`) are read-only
  from the client API.
* Deleting: fails with `DisplayException` if the server's `allocation_limit` is `0`
  (*"no allocation limit is set"*) or if it's the primary allocation
  (*"You cannot delete the primary allocation for this server."*).

**`AllocationTransformer` — exact attributes:**

```jsonc
{ "object": "allocation",
  "attributes": {
    "id": 42,               // int
    "ip": "10.0.0.1",       // string
    "ip_alias": null,       // string | null
    "port": 25565,          // int
    "notes": "game port",   // string | null
    "is_default": true      // bool  (= this is the server's primary allocation)
  } }
```

---

## 9. Users / subusers

Base: `/api/client/servers/{server}/users`; `{user}` = target **user UUID** (must already be a subuser
for view/update/delete).

| Method | Path | Permission | Body | Response |
|---|---|---|---|---|
| GET | `/` | `user.read` | — | list of `server_subuser` |
| POST | `/` | `user.create` | see below | item |
| GET | `/{user}` | `user.read` | — | item |
| POST | `/{user}` | `user.update` | `{ "permissions": string[] ✅ }` | item |
| DELETE | `/{user}` | `user.delete` | *(empty)* | **204** |

Create body (`StoreSubuserRequest`):

| Field | Type | Required |
|---|---|---|
| `email` | string (`email:strict`, `between:1,191`) | ✅ |
| `permissions` | string[] (each a string) | ✅ |

* Unknown permission strings are silently dropped (`array_intersect` against the full permission set).
* **`websocket.connect` is always added automatically.**
* You cannot assign a permission you yourself don't hold (unless you're `root_admin` or the server owner) →
  HTTP 403 *"Cannot assign permissions to a subuser that your account does not actively possess."*
* You cannot modify yourself (`SubuserRequest::authorize()` returns false) → 403.

**`SubuserTransformer` = `UserTransformer` fields + `permissions`, all flattened at the top level**
(there is no nested `user` object):

```jsonc
{ "object": "server_subuser",
  "attributes": {
    "uuid": "0d5d6b6e-…",           // string
    "identifier": "usr_abc12345",    // string
    "username": "jdoe",              // string
    "email": "a@b.c",                // string
    "image": "https://gravatar.com/avatar/<md5 of lowercase email>",
    "2fa_enabled": false,            // bool (use_totp)
    "created_at": "2023-01-01T00:00:00+00:00",   // ISO-8601 — same level, not under "user"
    "permissions": ["control.console", "websocket.connect", ...]  // string[]
  } }
```

---

## 10. Backups

Base: `/api/client/servers/{server}/backups`; `{backup}` = backup **UUID**.

| Method | Path | Permission | Body | Response |
|---|---|---|---|---|
| GET | `/` | `backup.read` | query `per_page` (default **20**, max **50**) | **paginated** list + `meta` |
| POST | `/` | `backup.create` | `{ "name"?: string(≤191), "is_locked"?: bool, "ignored"?: string }` | item |
| GET | `/{backup}` | `backup.read` | — | item |
| GET | `/{backup}/download` | `backup.download` | — | `{"object":"signed_url","attributes":{"url":…}}` |
| POST | `/{backup}/lock` | `backup.delete` | *(empty)* | item (lock **toggled**) |
| POST | `/{backup}/restore` | `backup.restore` | `{ "truncate": bool ✅ }` | **204** |
| DELETE | `/{backup}` | `backup.delete` | *(empty)* | **204** |

* `ignored` is a **newline-separated** string of ignore patterns (`explode(PHP_EOL, …)`).
* `is_locked` on create is only honoured if you have `backup.delete`.
* List response `meta` contains **both** `pagination` and `backup_count`:

```jsonc
"meta": { "backup_count": 3,
          "pagination": { "total": 3, "count": 3, "per_page": 20,
                          "current_page": 1, "total_pages": 1 } }
```

* Restore preconditions (HTTP 400 otherwise): server `status` must be `null`
  (*"This server is not currently in a state that allows for a backup to be restored."*),
  and the backup must be `is_successful && completed_at != null`.
* Download: the panel returns a **JSON signed URL**, it does **not** 302-redirect:
  `{"object":"signed_url","attributes":{"url":"…"}}`. The URL is produced by
  `DownloadLinkService` — exact per-disk shape (S3 presigned vs Wings proxy) is **UNVERIFIED**
  (see §14.3). Unknown disk adapter → HTTP 400.

**`BackupTransformer` — exact attributes:**

```jsonc
{ "object": "backup",
  "attributes": {
    "uuid": "b2f1…",              // string
    "is_successful": true,        // bool  (NOT "successful")
    "is_locked": false,           // bool  (NOT "locked")
    "name": "before update",
    "ignored_files": "cache/\nlogs/",   // string (newline separated), may be ""
    "checksum": "abc123…",        // string | null
    "bytes": 1048576,             // int   (NOT "size")
    "created_at": "2024-01-01T00:00:00+00:00",
    "completed_at": "2024-01-01T00:05:00+00:00"   // ISO-8601 | null
  } }
```

---

## 11. Startup

Base: `/api/client/servers/{server}/startup`

### `GET /api/client/servers/{server}/startup` (permission `startup.read`)

```jsonc
{
  "object": "list",
  "data": [
    { "object": "egg_variable",
      "attributes": {
        "name": "Server Jar File",
        "description": "…",
        "env_variable": "SERVER_JARFILE",
        "default_value": "server.jar",
        "server_value": "server.jar",       // effective value (default unless overridden)
        "is_editable": true,                // maps to user_editable
        "rules": "required|alpha_dash|…"    // Laravel validation rules string
      } }
  ],
  "meta": {
    "startup_command": "java -jar server.jar --version [hidden]",   // rendered, hidden vars masked
    "docker_images": { "paper": "paperimage/paper:latest", … },     // egg.docker_images (object map)
    "raw_startup_command": "java -jar {{SERVER_JARFILE}}"           // server.startup untouched
  }
}
```

> ✅ **Verified — the `meta` keys are `startup_command`, `docker_images`, `raw_startup_command`.**
> They are **not** `start_command` / `docker_image` / `images`
> (confirmed by `StartupController::index()` and `GetStartupAndVariablesTest`).
> Only `user_viewable = true` variables are returned.

### `PUT /api/client/servers/{server}/startup/variable` (permission `startup.update`)

Body:

| Field | Type | Required |
|---|---|---|
| `key` | string | ✅ — must be the variable's **`env_variable`** (e.g. `SERVER_JARFILE`), *not* `name` |
| `value` | any (`present`, may be `null`) | must be present; validated against the egg variable's own `rules` |

Response: **item** + meta (note: **no `docker_images`** here):

```jsonc
{ "object": "egg_variable",
  "attributes": { …same as above… },
  "meta": { "startup_command": "…", "raw_startup_command": "…" } }
```

Errors: HTTP 400 if the variable doesn't exist / isn't viewable
(*"The environment variable you are trying to edit does not exist."*) or isn't editable
(*"… is read-only."*).

---

## 12. Permissions

### `GET /api/client/permissions`

No params. Response (a raw object, not a Fractal envelope):

```jsonc
{
  "object": "system_permissions",
  "attributes": {
    "permissions": {
      "websocket": { "description": "…", "keys": { "connect": "…" } },
      "control":   { "description": "…", "keys": { "console": "…", "start": "…", "stop": "…", "restart": "…" } },
      "user":      { "description": "…", "keys": { "create", "read", "update", "delete" } },
      "file":      { "keys": { "create", "read", "read-content", "update", "delete", "archive", "sftp" } },
      "backup":    { "keys": { "create", "read", "delete", "download", "restore" } },
      "allocation":{ "keys": { "read", "create", "update", "delete" } },
      "startup":   { "keys": { "read", "update", "docker-image" } },
      "database":  { "keys": { "create", "read", "update", "delete", "view_password" } },
      "schedule":  { "keys": { "create", "read", "update", "delete" } },
      "settings":  { "keys": { "rename", "reinstall" } },
      "activity":  { "keys": { "read" } }
    }
  }
}
```

The full permission id is `"<group>.<key>"` (e.g. `file.read-content`, `startup.docker-image`,
`database.view_password`). Both `description` and per-key descriptions are present on every group
(`Permission::permissions()` returns the raw `$permissions` array).

The *effective* permissions for a user on a server come from
`GET /api/client/servers/{server}` → `meta.user_permissions` (flat `string[]`).

---

## 13. Gotchas (read this twice)

1. **Three different envelopes.** Items are `{object, attributes}`; lists are `{object:"list", data:[…]}`;
   a few endpoints bypass Fractal entirely (`GET …/websocket` → `{data:{token,socket}}`;
   signed-URL endpoints → `{object:"signed_url", attributes:{url}}`;
   `GET /permissions` → `{object:"system_permissions", attributes:{…}}`).
2. **Nested resources live under `attributes.relationships`, not at the top level.**
   A missing/forbidden include is `{"object":"null_resource","attributes":null}` — check for it.
3. **`allocations` and `variables` are included on every server object** (default includes), even
   without `?include=`.
4. **Pagination only where a paginator is used**: `GET /api/client` and `GET …/backups`
   → `meta.pagination = {total, count, per_page, current_page, total_pages}`.
   Files/databases/schedules/allocations/subusers lists are *not* paginated.
5. **Many endpoints return `204` with an empty body** — do not try to `JSON.parse` it
   (power, command, all file mutations except `list`/`compress`, database delete, subuser delete,
   schedule/task delete, allocation delete, backup delete/restore, settings rename/docker-image).
   `reinstall` and `schedule/execute` return **202**.
6. **Errors**: `{"errors":[{code, status, detail, meta?}]}` with `status` as a **string**;
   you only get JSON errors if your `Accept` header signals JSON.
7. **`{database}` is a Hashids id, `{schedule}`/`{task}`/`{allocation}` are integers, `{backup}` and
   `{user}` are UUIDs, `{server}` accepts UUID / uuidShort / `serv_` identifier.**
8. **Field names that differ from intuition**: `docker_image` (not `image`) on
   `PUT /settings/docker-image`; `bytes` (not `size`), `is_successful`/`is_locked` (not
   `successful`/`locked`) on backups; `connections_from`/`max_connections` (not `connections_to`) and a
   nested `host.{address,port}` on databases; `key` = `env_variable` on startup updates.
9. **`POST /files/rename` doesn't exist — it's `PUT`**, and file mutation bodies are `{root, files}` shaped.
10. **`files/write` sends `file` as a query param and the contents as the raw body**
    (`Content-Type: text/plain`). If you send `{"file":"…","content":"…"}` as JSON you will write the
    literal JSON string into the file.
11. **`month` is required in practice for schedules** even though it isn't validated — omitting it
    raises a PHP `TypeError` → HTTP 500.
12. **Rate limits**: 256 req/min by default, keyed by user UUID. Read `X-RateLimit-Remaining`;
    on 429 honour `Retry-After`.
13. **WebSocket tokens expire in 10 minutes**; watch for `token expiring` / `token expired` and re-fetch
    from `GET …/websocket`, then re-send `auth`. Never reconnect on close codes **4409/4400**.
14. **`stats` `args[0]` is a JSON string** — parse it; and note `uptime`/`disk_bytes` are ms/bytes
    fields that the REST `/resources` endpoint exposes under `attributes.resources.*` instead.
15. **`ptla_` keys are hard-rejected on `/api/client`** (403) by `RequireClientApiKey`; the Application
    API has no power/command/websocket/file endpoints whatsoever.

---

## 14. UNVERIFIED

Marked clearly, things I could **not** fully confirm from source:

1. **`Accept: application/vnd.pterodactyl.v1+json` enforcement** — I grepped all 1268 `.php`/`.ts`/`.tsx`
   files in `1.0-develop` for `vnd.pterodactyl` and found it only in one *test* case. So it appears to be
   an unenforced documented convention, but I did not run a byte-exact grep over non-code files
   (e.g. `docs/`, `.md`, vendor-published config), and I did not test against a live panel.
2. **`GET /files/contents` failure modes** — the exact status/body when a file exceeds
   `pterodactyl.files.max_edit_size`, or when the file doesn't exist, comes from Wings'
   `DaemonFileRepository`/Wings error handling; I did not trace the Wings side, so the precise status
   codes are **UNVERIFIED** (expect a panel `DaemonConnectionException` wrapping a Wings error body).
3. **Backup `GET …/backups/{backup}/download` URL shape per disk adapter** — the *file* download
   endpoint (`/files/download`) is verified: panel builds
   `sprintf('%s/download/file?token=%s', node_connection_address, jwt)` unconditionally. Backup
   downloads go through `DownloadLinkService`, whose exact per-disk URL (S3 presigned vs Wings proxy)
   I did not read.
4. **Exact `is_suspended`/`state` values returned by Wings' `/api/servers/{uuid}/resources`** —
   `StatsTransformer` reads `state` and `is_suspended` from the Wings payload; I verified the field
   *names* used by the panel but not the full enum Wings emits (frontend type says
   `offline | starting | running | stopping`).
5. **`?include=` behaviour for `egg`/`subusers` on `GET /api/client/servers/{server}`** — inferred from
   the shared `ServerTransformer` + `ApplicationApiController` include parsing; there is no integration
   test asserting the `egg` relationship shape specifically (the `allocations` shape *is* test-asserted).
6. **`RequireTwoFactorAuthentication` behaviour for API tokens** — present in the `api` middleware group,
   but I did not read its implementation; whether a 2FA-enrolled user's `ptlc_` key is blocked without a
   checkpoint is **UNVERIFIED**.
7. **`POST /api/client/servers/{server}/files/pull` response timing** — `pull` returns 204 immediately and
   the actual download happens asynchronously in Wings (or synchronously when `foreground: true`);
   I did not verify what (if anything) surfaces on the websocket when it finishes.
8. **Per-event throttling thresholds** — `router/websocket/limiter.go` is confirmed to emit
   `{"event":"throttled","args":["<event name>"]}` (vs. the socket-level `args:["global"]` limiter of
   10 msgs / 200 ms), but I did **not** read `limiter.go`'s bucket sizes, so the exact per-event
   thresholds are **UNVERIFIED**.
9. **`deleted` `args[0]` exact string** — the event is published with `nil` data and the generic
   listener JSON-marshals it, but I did not run Wings to observe the literal value (expected `"null"`).
