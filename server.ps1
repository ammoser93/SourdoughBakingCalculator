param(
  [int]$Port = 8765,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'

$rootDir = [System.IO.Path]::GetFullPath($PSScriptRoot)
$recipesDir = Join-Path $rootDir 'recipes'
$recipesFile = Join-Path $recipesDir 'recipes.json'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Ensure-RecipesFile {
  if (-not (Test-Path $recipesDir)) {
    New-Item -ItemType Directory -Force -Path $recipesDir | Out-Null
  }
  if (-not (Test-Path $recipesFile)) {
    $emptyJson = "{`n  `"version`": 1,`n  `"updatedAt`": `"$([DateTime]::UtcNow.ToString('o'))`",`n  `"recipes`": []`n}`n"
    [System.IO.File]::WriteAllText($recipesFile, $emptyJson, $utf8NoBom)
  }
}

function Get-LanIpv4Addresses {
  $primary = New-Object System.Collections.Generic.List[string]
  $secondary = New-Object System.Collections.Generic.List[string]

  foreach ($ni in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($ni.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) { continue }
    if ($ni.NetworkInterfaceType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback) { continue }

    $desc = ($ni.Name + ' ' + $ni.Description).ToLowerInvariant()
    $isVirtual = $desc -match 'vethernet|wsl|hyper-v|virtualbox|vmware|docker|tailscale|wireguard|zerotier|nordlynx|bluetooth|teredo|isatap'

    $props = $ni.GetIPProperties()
    $hasGateway = $false
    foreach ($gw in $props.GatewayAddresses) {
      if ($gw.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and $gw.Address.ToString() -ne '0.0.0.0') {
        $hasGateway = $true
        break
      }
    }

    foreach ($ua in $props.UnicastAddresses) {
      if ($ua.Address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { continue }
      $ip = $ua.Address.ToString()
      if ($ip.StartsWith('127.') -or $ip.StartsWith('169.254.')) { continue }

      if ($hasGateway -and -not $isVirtual) {
        if (-not $primary.Contains($ip)) { $primary.Add($ip) }
      } elseif (-not $isVirtual) {
        if (-not $secondary.Contains($ip)) { $secondary.Add($ip) }
      }
    }
  }

  if ($primary.Count -gt 0) { return $primary.ToArray() }
  return $secondary.ToArray()
}

$serverCode = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public class SourdoughHttpServer
{
    private readonly string _rootDir;
    private readonly string _rootWithSep;
    private readonly string _recipesFile;
    private readonly int _port;
    private readonly string[] _lanUrls;
    private readonly TcpListener _listener;
    private readonly object _fileLock = new object();
    private readonly UTF8Encoding _utf8NoBom = new UTF8Encoding(false);
    private volatile bool _running = false;
    private const int MaxBodyBytes = 5 * 1024 * 1024;

    public SourdoughHttpServer(string rootDir, string recipesFile, int port, string[] lanUrls)
    {
        _rootDir = Path.GetFullPath(rootDir);
        _rootWithSep = _rootDir.TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
        _recipesFile = recipesFile;
        _port = port;
        _lanUrls = lanUrls ?? new string[0];
        _listener = new TcpListener(IPAddress.Any, port);
    }

    public void Start()
    {
        _listener.Start();
        _running = true;
        ThreadPool.QueueUserWorkItem(AcceptLoop);
    }

    public void Stop()
    {
        _running = false;
        try { _listener.Stop(); } catch { }
    }

    private void AcceptLoop(object state)
    {
        while (_running)
        {
            try
            {
                TcpClient client = _listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(HandleClient, client);
            }
            catch
            {
                if (!_running) break;
                Thread.Sleep(25);
            }
        }
    }

    private void HandleClient(object state)
    {
        TcpClient client = (TcpClient)state;
        string remoteIp = "unknown";
        try
        {
            IPEndPoint ep = client.Client.RemoteEndPoint as IPEndPoint;
            if (ep != null) remoteIp = ep.Address.ToString();

            client.ReceiveTimeout = 8000;
            client.SendTimeout = 8000;
            client.NoDelay = true;

            using (NetworkStream stream = client.GetStream())
            {
                ProcessRequest(stream, remoteIp);
            }
        }
        catch
        {
            // Ignore abrupt disconnects / idle preconnect timeouts
        }
        finally
        {
            try { client.Client.Shutdown(SocketShutdown.Both); } catch { }
            try { client.Close(); } catch { }
        }
    }

    private static int FindHeaderEnd(byte[] buffer, int length)
    {
        for (int i = 0; i <= length - 4; i++)
        {
            if (buffer[i] == 13 && buffer[i + 1] == 10 && buffer[i + 2] == 13 && buffer[i + 3] == 10)
            {
                return i + 4;
            }
        }
        return -1;
    }

    private void Log(string remoteIp, string message)
    {
        Console.WriteLine(string.Format("[{0}] {1} {2}", DateTime.Now.ToString("HH:mm:ss"), remoteIp, message));
    }

    private void ProcessRequest(NetworkStream stream, string remoteIp)
    {
        MemoryStream ms = new MemoryStream();
        byte[] chunk = new byte[4096];
        int headerEnd = -1;

        while (headerEnd < 0)
        {
            int read = stream.Read(chunk, 0, chunk.Length);
            if (read <= 0) return;

            // Detect TLS ClientHello (HTTPS attempted on HTTP port)
            if (ms.Length == 0 && read >= 2 && chunk[0] == 0x16 && chunk[1] == 0x03)
            {
                Log(remoteIp, "HTTPS request rejected -> use http:// instead of https://");
                return;
            }

            ms.Write(chunk, 0, read);
            if (ms.Length > 65536)
            {
                SendText(stream, 400, "text/plain; charset=utf-8", "Bad Request", false);
                return;
            }
            headerEnd = FindHeaderEnd(ms.GetBuffer(), (int)ms.Length);
        }

        byte[] rawBuf = ms.GetBuffer();
        string headerText = Encoding.ASCII.GetString(rawBuf, 0, headerEnd - 4);
        string[] lines = headerText.Split(new string[] { "\r\n" }, StringSplitOptions.None);
        if (lines.Length < 1)
        {
            SendText(stream, 400, "text/plain; charset=utf-8", "Bad Request", false);
            return;
        }

        string[] reqParts = lines[0].Split(' ');
        if (reqParts.Length < 2)
        {
            SendText(stream, 400, "text/plain; charset=utf-8", "Bad Request", false);
            return;
        }

        string method = reqParts[0].ToUpperInvariant();
        string rawTarget = reqParts[1];
        int contentLength = 0;

        for (int i = 1; i < lines.Length; i++)
        {
            int colon = lines[i].IndexOf(':');
            if (colon > 0)
            {
                string hName = lines[i].Substring(0, colon).Trim().ToLowerInvariant();
                string hVal = lines[i].Substring(colon + 1).Trim();
                if (hName == "content-length")
                {
                    int parsed;
                    if (int.TryParse(hVal, out parsed) && parsed >= 0)
                    {
                        contentLength = parsed;
                    }
                }
            }
        }

        if (contentLength > MaxBodyBytes)
        {
            SendText(stream, 413, "text/plain; charset=utf-8", "Payload Too Large", false);
            return;
        }

        byte[] bodyBytes = new byte[contentLength];
        int alreadyBodyLen = (int)ms.Length - headerEnd;
        int copied = 0;
        if (alreadyBodyLen > 0 && contentLength > 0)
        {
            int toCopy = Math.Min(alreadyBodyLen, contentLength);
            Array.Copy(rawBuf, headerEnd, bodyBytes, 0, toCopy);
            copied = toCopy;
        }
        while (copied < contentLength)
        {
            int read = stream.Read(bodyBytes, copied, contentLength - copied);
            if (read <= 0) break;
            copied += read;
        }

        int qIdx = rawTarget.IndexOf('?');
        string pathOnly = qIdx >= 0 ? rawTarget.Substring(0, qIdx) : rawTarget;
        string urlPath = Uri.UnescapeDataString(pathOnly);
        bool headOnly = (method == "HEAD");

        if (method == "OPTIONS")
        {
            SendBytes(stream, 204, "text/plain", new byte[0], true);
            return;
        }

        if (urlPath == "/api/health" && (method == "GET" || headOnly))
        {
            string healthJson = BuildHealthJson();
            SendText(stream, 200, "application/json; charset=utf-8", healthJson, headOnly);
            return;
        }

        if (urlPath == "/api/recipes" && (method == "GET" || headOnly))
        {
            string jsonText;
            lock (_fileLock)
            {
                EnsureRecipesFile();
                jsonText = File.ReadAllText(_recipesFile, _utf8NoBom);
            }
            SendText(stream, 200, "application/json; charset=utf-8", jsonText, headOnly);
            Log(remoteIp, string.Format("{0} {1} -> 200", method, urlPath));
            return;
        }

        if (urlPath == "/api/recipes" && method == "PUT")
        {
            string bodyText = _utf8NoBom.GetString(bodyBytes);
            string trimmed = bodyText.Trim();
            if (!trimmed.StartsWith("{") || !trimmed.Contains("\"recipes\""))
            {
                SendText(stream, 400, "application/json; charset=utf-8", "{\"error\":\"Payload must contain a recipes array.\"}", false);
                Log(remoteIp, "PUT /api/recipes -> 400");
                return;
            }

            lock (_fileLock)
            {
                EnsureRecipesFile();
                string tmp = _recipesFile + ".tmp";
                File.WriteAllText(tmp, bodyText, _utf8NoBom);
                if (File.Exists(_recipesFile)) File.Delete(_recipesFile);
                File.Move(tmp, _recipesFile);
            }
            SendText(stream, 200, "application/json; charset=utf-8", "{\"ok\":true}", false);
            Log(remoteIp, "PUT /api/recipes -> 200 (saved)");
            return;
        }

        if (method != "GET" && !headOnly)
        {
            SendText(stream, 405, "text/plain; charset=utf-8", "Method Not Allowed", false);
            return;
        }

        string rel = urlPath.TrimStart('/');
        if (string.IsNullOrWhiteSpace(rel)) rel = "index.html";
        rel = rel.Replace('/', Path.DirectorySeparatorChar);

        string fullPath;
        try
        {
            fullPath = Path.GetFullPath(Path.Combine(_rootDir, rel));
        }
        catch
        {
            SendText(stream, 400, "text/plain; charset=utf-8", "Bad Request", headOnly);
            return;
        }

        if (!fullPath.StartsWith(_rootWithSep, StringComparison.OrdinalIgnoreCase))
        {
            SendText(stream, 403, "text/plain; charset=utf-8", "Forbidden", headOnly);
            Log(remoteIp, string.Format("{0} {1} -> 403", method, urlPath));
            return;
        }

        if (!File.Exists(fullPath))
        {
            SendText(stream, 404, "text/plain; charset=utf-8", "Not Found", headOnly);
            Log(remoteIp, string.Format("{0} {1} -> 404", method, urlPath));
            return;
        }

        byte[] fileBytes = File.ReadAllBytes(fullPath);
        SendBytes(stream, 200, GetMimeType(fullPath), fileBytes, headOnly);
        if (urlPath == "/" || urlPath.EndsWith(".html"))
        {
            Log(remoteIp, string.Format("{0} {1} -> 200", method, urlPath));
        }
    }

    private void EnsureRecipesFile()
    {
        string dir = Path.GetDirectoryName(_recipesFile);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
        {
            Directory.CreateDirectory(dir);
        }
        if (!File.Exists(_recipesFile))
        {
            string empty = "{\n  \"version\": 1,\n  \"updatedAt\": \"" + DateTime.UtcNow.ToString("o") + "\",\n  \"recipes\": []\n}\n";
            File.WriteAllText(_recipesFile, empty, _utf8NoBom);
        }
    }

    private string BuildHealthJson()
    {
        StringBuilder sb = new StringBuilder();
        sb.Append("{\"ok\":true,\"file\":\"recipes/recipes.json\",\"port\":");
        sb.Append(_port);
        sb.Append(",\"lanUrls\":[");
        for (int i = 0; i < _lanUrls.Length; i++)
        {
            if (i > 0) sb.Append(",");
            sb.Append("\"");
            sb.Append(_lanUrls[i].Replace("\\", "\\\\").Replace("\"", "\\\""));
            sb.Append("\"");
        }
        sb.Append("]}");
        return sb.ToString();
    }

    private static string GetStatusText(int code)
    {
        switch (code)
        {
            case 200: return "OK";
            case 204: return "No Content";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 413: return "Payload Too Large";
            default: return "Internal Server Error";
        }
    }

    private static string GetMimeType(string path)
    {
        string ext = Path.GetExtension(path).ToLowerInvariant();
        switch (ext)
        {
            case ".html": return "text/html; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".js": return "application/javascript; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".webmanifest": return "application/manifest+json; charset=utf-8";
            case ".svg": return "image/svg+xml";
            case ".png": return "image/png";
            case ".ico": return "image/x-icon";
            default: return "application/octet-stream";
        }
    }

    private void SendText(NetworkStream stream, int code, string contentType, string text, bool headOnly)
    {
        SendBytes(stream, code, contentType, _utf8NoBom.GetBytes(text), headOnly);
    }

    private static void SendBytes(NetworkStream stream, int code, string contentType, byte[] body, bool headOnly)
    {
        if (body == null) body = new byte[0];
        string headers = string.Format(
            "HTTP/1.1 {0} {1}\r\nContent-Type: {2}\r\nContent-Length: {3}\r\nCache-Control: no-cache, no-store, must-revalidate\r\nConnection: close\r\n\r\n",
            code, GetStatusText(code), contentType, body.Length
        );
        byte[] headerBytes = Encoding.ASCII.GetBytes(headers);
        stream.Write(headerBytes, 0, headerBytes.Length);
        if (!headOnly && body.Length > 0)
        {
            stream.Write(body, 0, body.Length);
        }
        stream.Flush();
    }
}
'@

if (-not ('SourdoughHttpServer' -as [type])) {
  Add-Type -TypeDefinition $serverCode -Language CSharp
}

Ensure-RecipesFile

$lanIps = Get-LanIpv4Addresses
$hostName = [System.Net.Dns]::GetHostName()
$server = $null
$boundPort = $null

for ($p = $Port; $p -le ($Port + 10); $p++) {
  $urlsForPort = New-Object System.Collections.Generic.List[string]
  foreach ($ip in $lanIps) {
    $urlsForPort.Add("http://${ip}:$p/")
  }
  if (-not [string]::IsNullOrWhiteSpace($hostName)) {
    $urlsForPort.Add("http://${hostName}.local:$p/")
  }

  $candidate = New-Object SourdoughHttpServer($rootDir, $recipesFile, $p, $urlsForPort.ToArray())
  try {
    $candidate.Start()
    $server = $candidate
    $boundPort = $p
    $lanUrls = $urlsForPort
    break
  } catch {
    $candidate.Stop()
  }
}

if (-not $server) {
  Write-Error "Could not bind to any port between $Port and $($Port + 10)."
  exit 1
}

$localUrl = "http://localhost:$boundPort/"

Write-Host ""
Write-Host "  Sourdough Baking Calculator is running!" -ForegroundColor Green
Write-Host "  On this PC:   $localUrl" -ForegroundColor Cyan
if ($lanUrls.Count -gt 0) {
  Write-Host "  On your phone (same Wi-Fi):" -ForegroundColor Yellow
  foreach ($u in $lanUrls) {
    Write-Host "    -> $u" -ForegroundColor White
  }
}
Write-Host "  Recipes JSON: $recipesFile" -ForegroundColor Gray
Write-Host "  Keep this window open while using the app. Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

if (-not $NoOpen) {
  Start-Process $localUrl
}

try {
  while ($true) {
    Start-Sleep -Milliseconds 200
  }
} finally {
  if ($server) {
    $server.Stop()
  }
}
