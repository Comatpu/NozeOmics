using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// HTTPS transports releases; the embedded public key establishes who published them.
// Installations are immutable. active.json changes only after the new app starts.
internal sealed class UpdateSelection
{
    public string Runtime, PreviousRuntime, Envelope, Version, NewRuntimeEnvelope;
    public bool Pending;
}

internal static class PortableUpdates
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 1024 * 1024 };
    internal static Action<string, int> Progress = delegate { };
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateHardLink(string newName, string existingName, IntPtr security);

    internal static T WithProgress<T>(Func<T> work, bool visible)
    {
        if (!visible) return work();
        T answer = default(T); Exception failure = null;
        using (var form = new Form { Text = "NozeOmics", Width = 390, Height = 132, FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false, MinimizeBox = false, ControlBox = false, StartPosition = FormStartPosition.CenterScreen })
        {
            var label = new Label { Left = 20, Top = 18, Width = 344, Height = 22, Text = "Checking for updates…" };
            var bar = new ProgressBar { Left = 20, Top = 50, Width = 344, Height = 16, Style = ProgressBarStyle.Marquee };
            form.Controls.Add(label); form.Controls.Add(bar);
            Progress = (message, percent) => { if (!form.IsDisposed && form.IsHandleCreated) try { form.BeginInvoke((Action)(() => {
                label.Text = message; bar.Style = percent < 0 ? ProgressBarStyle.Marquee : ProgressBarStyle.Continuous;
                if (percent >= 0) bar.Value = Math.Max(0, Math.Min(100, percent));
            })); } catch (InvalidOperationException) { } };
            form.Shown += delegate { Task.Run(() => { try { answer = work(); } catch (Exception e) { failure = e; }
                finally { try { form.BeginInvoke((Action)(() => form.Close())); } catch (InvalidOperationException) { } } }); };
            Application.Run(form);
            Progress = delegate { };
        }
        if (failure != null) throw failure;
        return answer;
    }

    internal static bool Running(string home)
    {
        try { var c = Object(File.ReadAllText(Path.Combine(home, "connection.json"))); var uri = new Uri(Text(c, "url"));
            if (uri.Scheme != "http" || uri.Host != "127.0.0.1") return false;
            return Fetch(uri.AbsoluteUri.TrimEnd('/') + "/health", 1000).Length > 0;
        } catch { return false; }
    }

    internal static UpdateSelection Select(string home, string embedded, bool online)
    {
        var current = new UpdateSelection { Runtime = embedded, PreviousRuntime = embedded, Version = UpdateConfig.Version };
        string folder = Path.Combine(home, "updates"); Directory.CreateDirectory(folder);
        string active = Path.Combine(folder, "active.json");
        string baseId = UpdateConfig.RuntimeId, runtimeBase = embedded, runtimeBaseEnvelope = null;
        try { string savedBase = Path.Combine(folder, "runtime-base.json"); if (File.Exists(savedBase)) {
            runtimeBaseEnvelope = File.ReadAllText(savedBase); var baseRelease = Verify(runtimeBaseEnvelope);
            runtimeBase = Prepare(folder, embedded, baseRelease, "force-full"); baseId = Text(baseRelease, "runtime_id");
        } } catch (Exception e) { Log(home, "Cached runtime unavailable: " + e.Message); }
        try { if (File.Exists(active)) { string saved = File.ReadAllText(active); var release = Verify(saved);
            if (Compare(Text(release, "version"), current.Version) >= 0) current = new UpdateSelection {
                Runtime = saved == runtimeBaseEnvelope ? runtimeBase : Prepare(folder, runtimeBase, release, baseId), PreviousRuntime = embedded, Envelope = saved, Version = Text(release, "version") };
        } } catch (Exception e) {
            Log(home, "Installed update could not be loaded: " + e.Message);
            try { string previous = Path.Combine(folder, "previous.json"); if (File.Exists(previous)) {
                string saved = File.ReadAllText(previous); var release = Verify(saved);
                if (Compare(Text(release, "version"), current.Version) >= 0) current = new UpdateSelection {
                    Runtime = saved == runtimeBaseEnvelope ? runtimeBase : Prepare(folder,
                        Text(release, "runtime_id") == UpdateConfig.RuntimeId ? embedded : runtimeBase, release,
                        Text(release, "runtime_id") == UpdateConfig.RuntimeId ? UpdateConfig.RuntimeId : baseId),
                    PreviousRuntime = embedded, Envelope = saved, Version = Text(release, "version") };
            } } catch (Exception recovery) { Log(home, "Previous update could not be loaded: " + recovery.Message); }
        }
        if (!online) return current;
        try
        {
            Progress("Checking for updates…", -1);
            string envelope = Encoding.UTF8.GetString(Fetch(UpdateConfig.Feed, 3500));
            var release = Verify(envelope);
            if (Compare(Text(release, "version"), current.Version) <= 0) return current;
            string rejected = Path.Combine(folder, "rejected.json");
            if (File.Exists(rejected) && File.ReadAllText(rejected) == Fingerprint(envelope)) return current;
            var asset = Asset(release, baseId);
            string archive = Download(folder, asset);
            string runtime = Prepare(folder, runtimeBase, release, baseId);
            return new UpdateSelection { Runtime = runtime, PreviousRuntime = current.Runtime, Envelope = envelope,
                Version = Text(release, "version"), Pending = true,
                NewRuntimeEnvelope = Text(release, "runtime_id") != baseId ? envelope : null };
        }
        catch (Exception e) { Log(home, "Update check/download failed; keeping current version: " + e.Message); return current; }
    }

    internal static Dictionary<string, object> Verify(string envelope)
    {
        var wrapper = Object(envelope);
        byte[] payload = Convert.FromBase64String(Text(wrapper, "payload")), signature = Convert.FromBase64String(Text(wrapper, "signature"));
        if (payload.Length > 128 * 1024) throw new InvalidDataException("Release metadata is too large.");
        using (var rsa = new RSACryptoServiceProvider())
        {
            rsa.PersistKeyInCsp = false;
            rsa.ImportParameters(new RSAParameters { Modulus = Convert.FromBase64String(UpdateConfig.Modulus), Exponent = Convert.FromBase64String(UpdateConfig.Exponent) });
            if (!rsa.VerifyData(payload, CryptoConfig.MapNameToOID("SHA256"), signature)) throw new InvalidDataException("Release publisher signature is invalid.");
        }
        var release = Object(Encoding.UTF8.GetString(payload));
        if (Number(release, "schema") != 1 || Number(release, "launcher_protocol") > 1 || Number(release, "data_schema") != 1)
            throw new InvalidDataException("This release requires a newer compatible launcher.");
        ParseVersion(Text(release, "version"));
        if (Text(release, "channel") != "stable") throw new InvalidDataException("Not a stable release.");
        ValidateAsset((Dictionary<string, object>)release["app"], 100L * 1024 * 1024);
        ValidateAsset((Dictionary<string, object>)release["full"], 2L * 1024 * 1024 * 1024);
        return release;
    }

    private static void ValidateAsset(Dictionary<string, object> asset, long maximum)
    {
        string hash = Text(asset, "sha256"); var uri = new Uri(Text(asset, "url")); long size = Number(asset, "size");
        if (hash.Length != 64 || hash.Any(c => !Uri.IsHexDigit(c)) || size <= 0 || size > maximum)
            throw new InvalidDataException("Invalid update size/hash.");
        if (uri.Scheme != "https" || uri.Host != "github.com" || !String.IsNullOrEmpty(uri.UserInfo)
            || !uri.AbsolutePath.StartsWith("/" + UpdateConfig.Repository + "/releases/download/", StringComparison.Ordinal))
#if UPDATE_TESTS
            if (!(uri.Scheme == "http" && uri.Host == "127.0.0.1" && String.IsNullOrEmpty(uri.UserInfo)))
#endif
            throw new InvalidDataException("Untrusted update download location.");
    }

    private static Dictionary<string, object> Asset(Dictionary<string, object> release, string baseId)
    { return (Dictionary<string, object>)release[Text(release, "runtime_id") == baseId ? "app" : "full"]; }

    private static string Download(string folder, Dictionary<string, object> asset)
    {
        string hash = Text(asset, "sha256").ToLowerInvariant(), archive = Path.Combine(folder, hash + ".zip");
        if (ValidArchive(archive, asset)) return archive;
        string partial = archive + ".part-" + Process.GetCurrentProcess().Id;
        var request = (HttpWebRequest)WebRequest.Create(Text(asset, "url"));
        request.UserAgent = "NozeOmics/" + UpdateConfig.Version; request.Timeout = 15000; request.ReadWriteTimeout = 15000;
        request.AllowAutoRedirect = false;
        try
        {
            using (var response = Response(request, 0))
            using (var source = response.GetResponseStream())
            using (var target = File.Create(partial))
            {
                long expected = Number(asset, "size"), count = 0; var bytes = new byte[128 * 1024]; int read;
                var started = Stopwatch.StartNew();
                while ((read = source.Read(bytes, 0, bytes.Length)) > 0)
                {
                    count += read;
                    if (count > expected || started.Elapsed.TotalMinutes > 10) throw new InvalidDataException("Update download exceeded its limit.");
                    target.Write(bytes, 0, read); Progress("Downloading update…", (int)(count * 100 / expected));
                }
            }
            if (!ValidArchive(partial, asset)) throw new InvalidDataException("Downloaded update failed integrity verification.");
            if (File.Exists(archive)) File.Delete(archive);
            File.Move(partial, archive); return archive;
        }
        finally { if (File.Exists(partial)) File.Delete(partial); }
    }

    private static HttpWebResponse Response(HttpWebRequest request, int redirects)
    {
        var response = (HttpWebResponse)request.GetResponse();
        if ((int)response.StatusCode >= 300 && (int)response.StatusCode < 400)
        {
            string location = response.Headers["Location"]; response.Close();
            if (redirects >= 5 || String.IsNullOrEmpty(location)) throw new IOException("Too many update redirects.");
            var uri = new Uri(request.RequestUri, location);
            if (uri.Scheme != "https" || !String.IsNullOrEmpty(uri.UserInfo)) throw new IOException("Unsafe update redirect.");
            var next = (HttpWebRequest)WebRequest.Create(uri); next.AllowAutoRedirect = false; next.Timeout = request.Timeout;
            next.ReadWriteTimeout = request.ReadWriteTimeout; next.UserAgent = request.UserAgent;
            return Response(next, redirects + 1);
        }
        if (response.StatusCode != HttpStatusCode.OK) { response.Close(); throw new IOException("Update server returned an unexpected response."); }
        return response;
    }

    private static byte[] Fetch(string url, int timeout)
    {
        var request = (HttpWebRequest)WebRequest.Create(url); request.Timeout = timeout; request.ReadWriteTimeout = timeout;
        request.UserAgent = "NozeOmics/" + UpdateConfig.Version; request.AllowAutoRedirect = false;
        using (var response = Response(request, 0)) using (var source = response.GetResponseStream()) using (var target = new MemoryStream())
        { var bytes = new byte[8192]; int n; while ((n = source.Read(bytes, 0, bytes.Length)) > 0) {
            if (target.Length + n > 1024 * 1024) throw new IOException("Update response exceeded its limit."); target.Write(bytes, 0, n);
        } return target.ToArray(); }
    }

    private static bool ValidArchive(string path, Dictionary<string, object> asset)
    {
        if (!File.Exists(path) || new FileInfo(path).Length != Number(asset, "size")) return false;
        using (var file = File.OpenRead(path)) using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "").ToLowerInvariant() == Text(asset, "sha256").ToLowerInvariant();
    }

    internal static string Prepare(string folder, string embedded, Dictionary<string, object> release, string baseId)
    {
        var asset = Asset(release, baseId); string hash = Text(asset, "sha256").ToLowerInvariant();
        string archive = Path.Combine(folder, hash + ".zip");
        if (!ValidArchive(archive, asset)) throw new IOException("The stored update is incomplete.");
        // Include the exact embedded baseline in the cache key; compatible portable
        // snapshots may contain different app files despite sharing a runtime ID.
        string baseline = Fingerprint(embedded).Replace('/', '_').Replace('+', '-').Substring(0, 12);
        string cache = Path.Combine(Path.GetTempPath(), "NO", "u-" + baseline + "-" + hash.Substring(0, 16));
        string ready = Path.Combine(cache, ".update-complete");
        using (var mutex = new Mutex(false, "Local\\NozeOmics-update-" + hash))
        {
            try { if (!mutex.WaitOne(TimeSpan.FromSeconds(60))) throw new IOException("An update is still being prepared."); }
            catch (AbandonedMutexException) { }
            try
            {
                if (File.Exists(ready) && File.ReadAllText(ready) == hash) { CheckApp(cache, Text(release, "version")); return cache; }
                string stage = cache + "-b" + Process.GetCurrentProcess().Id + "-" + Guid.NewGuid().ToString("N");
                Directory.CreateDirectory(stage);
                Progress("Preparing update…", -1);
                bool appOnly = Text(release, "runtime_id") == baseId;
                if (appOnly) ShareRuntime(embedded, stage);
                ExtractArchive(archive, appOnly ? Path.Combine(stage, "resources", "app") : stage, appOnly);
                CheckApp(stage, Text(release, "version"));
                File.WriteAllText(Path.Combine(stage, ".update-complete"), hash);
                if (Directory.Exists(cache)) cache += "-r" + Guid.NewGuid().ToString("N");
                Directory.Move(stage, cache); return cache;
            }
            finally { mutex.ReleaseMutex(); }
        }
    }

    private static void ShareRuntime(string source, string destination)
    {
        foreach (string file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            string relative = file.Substring(source.TrimEnd(Path.DirectorySeparatorChar).Length + 1);
            string appPrefix = "resources" + Path.DirectorySeparatorChar + "app" + Path.DirectorySeparatorChar;
            if (relative.StartsWith(appPrefix, StringComparison.OrdinalIgnoreCase) && !relative.StartsWith(appPrefix + "runtime" + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
            if (relative == ".complete" || relative == ".update-complete") continue;
            string target = Path.Combine(destination, relative); Directory.CreateDirectory(Path.GetDirectoryName(target));
            if (!CreateHardLink(target, file, IntPtr.Zero)) File.Copy(file, target);
        }
    }

    internal static void ExtractArchive(string archive, string destination, bool appOnly)
    {
        long total = 0; var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string prefix = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        using (var zip = ZipFile.OpenRead(archive))
        {
            if (zip.Entries.Count > 100000) throw new InvalidDataException("Too many update files.");
            foreach (var entry in zip.Entries)
            {
                string name = entry.FullName.Replace('\\', '/');
                string[] parts = name.TrimEnd('/').Split('/');
                if (parts.Any(p => String.IsNullOrEmpty(p) || p == "." || p == ".." || p.EndsWith(".") || p.EndsWith(" ") || p.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || Reserved(p))
                    || (entry.ExternalAttributes >> 16 & 0xF000) == 0xA000 || !names.Add(name.TrimEnd('/')))
                    throw new InvalidDataException("Unsafe update entry.");
                if (appOnly && !new[] { "frontend", "backend", "desktop", "mcp", "assets", "plugin", "package.json", "release.json" }.Contains(parts[0]))
                    throw new InvalidDataException("Unexpected application update file.");
                string target = Path.GetFullPath(Path.Combine(destination, name));
                if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Update file escaped its installation.");
                if (String.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(target); continue; }
                total += entry.Length;
                if (entry.Length < 0 || total > (appOnly ? 150L : 5000L) * 1024 * 1024) throw new InvalidDataException("Update extraction exceeded its limit.");
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                // New files only: never overwrite a shared hard link or user data.
                using (var input = entry.Open()) using (var output = new FileStream(target, FileMode.CreateNew))
                { var bytes = new byte[65536]; long written = 0; int n; while ((n = input.Read(bytes, 0, bytes.Length)) > 0) {
                    written += n; if (written > entry.Length) throw new InvalidDataException("Invalid update entry length."); output.Write(bytes, 0, n);
                } if (written != entry.Length) throw new InvalidDataException("Truncated update entry."); }
            }
        }
    }

    private static bool Reserved(string name)
    { string stem = name.Split('.')[0].ToUpperInvariant(); return new[] { "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9" }.Contains(stem); }

    private static void CheckApp(string runtime, string version)
    {
        foreach (string relative in new[] { "NozeOmics.exe", "resources/app/desktop/main.cjs", "resources/app/desktop/preload.cjs", "resources/app/mcp/adapter.cjs", "resources/app/backend/server.py", "resources/app/frontend/index.html", "resources/app/runtime/python/python.exe", "resources/app/runtime/R/bin/Rscript.exe" })
            if (!File.Exists(Path.Combine(runtime, relative))) throw new InvalidDataException("Update is missing " + relative);
        var info = Object(File.ReadAllText(Path.Combine(runtime, "resources/app/release.json")));
        var package = Object(File.ReadAllText(Path.Combine(runtime, "resources/app/package.json")));
        if (Text(info, "version") != version || Text(package, "version") != version) throw new InvalidDataException("Update version does not match its signed metadata.");
    }

    internal static void Commit(string home, UpdateSelection selection)
    { if (selection.Pending) { string active = Path.Combine(home, "updates", "active.json");
        if (File.Exists(active)) { try { string previous = File.ReadAllText(active); Verify(previous);
            WriteAtomic(Path.Combine(home, "updates", "previous.json"), previous); } catch (Exception error) { Log(home, "Previous receipt backup failed: " + error.Message); } }
        WriteAtomic(active, selection.Envelope);
        if (selection.NewRuntimeEnvelope != null) WriteAtomic(Path.Combine(home, "updates", "runtime-base.json"), selection.NewRuntimeEnvelope); } }
    internal static void Reject(string home, UpdateSelection selection)
    { WriteAtomic(Path.Combine(home, "updates", "rejected.json"), Fingerprint(selection.Envelope)); Log(home, "New version failed to start; reverting to previous version: " + selection.Version); }
    internal static void Log(string home, string message)
    { try { Directory.CreateDirectory(Path.Combine(home, "updates")); File.AppendAllText(Path.Combine(home, "updates", "updates.log"), DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine); } catch { } }
    private static void WriteAtomic(string path, string text)
    { string stage = path + ".tmp-" + Guid.NewGuid().ToString("N"); File.WriteAllText(stage, text); if (File.Exists(path)) File.Replace(stage, path, null); else File.Move(stage, path); }
    private static string Fingerprint(string text)
    { using (var sha = SHA256.Create()) return Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(text))); }
    internal static Dictionary<string, object> Object(string text) { return Json.Deserialize<Dictionary<string, object>>(text); }
    internal static string Text(Dictionary<string, object> obj, string key) { return (string)obj[key]; }
    private static long Number(Dictionary<string, object> obj, string key) { return Convert.ToInt64(obj[key]); }
    private static int[] ParseVersion(string version)
    { string[] parts = version.Split('.'); if (parts.Length != 3 || parts.Any(p => p.Length == 0 || p.Length > 8 || p.Any(c => c < '0' || c > '9'))) throw new InvalidDataException("Invalid release version."); return parts.Select(Int32.Parse).ToArray(); }
    internal static int Compare(string a, string b)
    { int[] aa = ParseVersion(a), bb = ParseVersion(b); for (int i = 0; i < 3; i++) if (aa[i] != bb[i]) return aa[i].CompareTo(bb[i]); return 0; }
}
