# Fleet Pulse

Fleet Pulse is an Angular dashboard for monitoring a 2,000-service fleet. It uses the mock API and stream server in `../backend`.

## Run locally

Start the API:

```powershell
cd backend
npm ci
npm start
```

In another terminal, run the frontend:

```powershell
cd frontend
npm ci
npm start
```

Open `http://localhost:4200`. Demo accounts (both use password `pulse123`):

| Role     | Email                |
| -------- | -------------------- |
| Operator | `operator@pulse.dev` |
| Viewer   | `viewer@pulse.dev`   |

Tokens are held in memory; refreshing the page requires signing in again.

## Features

- Virtualized fleet table with URL-backed search, status filters, and sorting. Only the visible range plus a bounded buffer is rendered.
- Service detail history with a 300-point maximum, live metric updates, stale-data notice, and retryable history errors.
- Operator-only alert-rule creation and editing, including dynamic conditions, cross-field validation, asynchronous name checks, optimistic persistence with rollback, and active incident evaluation.
- Optional browser notifications. Grant permission on the Rules page and enable them in Settings.
- Local browser preferences for compact rows and stale-data threshold.
- Live connection state in the app toolbar with an `aria-live` announcement.

## Tests and quality checks

```powershell
npm test -- --watch=false
npm run lint
npm run build
```

The tests cover the auth and stream pipeline, rule condition evaluation, and the virtual fleet rendering limit.

## 4x CPU-throttle performance check

1. Start the local backend and frontend, sign in as the operator, and open the Fleet page.
2. Open Chrome DevTools **Performance**, set CPU throttling to **4x slowdown**, and begin a 30-second recording.
3. In DevTools Console, set the generator rate to 2,000 events/second:

   ```js
   fetch('http://localhost:4000/chaos', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ rate: 2000 }),
   });
   ```

4. Confirm the **Fleet** page continues to respond, the toolbar connection remains live, and the UI presents batched updates rather than repainting once per event. In the console, measure the rendered row count:

   ```js
   document.querySelectorAll('.service-viewport tbody tr').length;
   ```

   The count must remain below 60 while the service count remains 2,000. The stream store applies updates on the configured 250 ms UI batch interval.

5. Reset the mock server after recording:

   ```js
   fetch('http://localhost:4000/chaos', { method: 'DELETE' });
   ```

Record the browser/OS, 4x setting, event rate, row count, and any long tasks when reporting a performance run. The mock stream rate can be adjusted with the backend `/chaos` endpoint.

### Measured smoke run

In the current Chromium workspace, a 30-second run at **4x CPU slowdown** and **2,000 events/second** kept the connection live with all 2,000 services loaded. The maximum rendered virtual-table row count sampled every 100 ms was **23** (requirement: fewer than 60). The browser reported 27 long tasks totaling 3.281 seconds over the run; repeat measurements on the target hardware before using this as a production performance baseline.

## Docker Compose

From the repository root:

```powershell
docker compose up --build
```

Open `http://localhost:8080`. The frontend container serves the Angular app through Nginx, and the API remains available at `http://localhost:4000` to the browser. Stop the stack with `docker compose down`.
