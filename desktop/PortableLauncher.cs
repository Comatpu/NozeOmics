using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("NozeOmics")]
[assembly: AssemblyProduct("NozeOmics")]

// One portable EXE contains the complete Electron/Python/R runtime. Only user
// data lives beside it; extracted program files are a disposable temp cache.
internal static class PortableLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        bool mcp = args.Contains("--mcp");
        try
        {
            string outer = Assembly.GetExecutingAssembly().Location;
            string data = Environment.GetEnvironmentVariable("NOZEOMICS_HOME");
            if (String.IsNullOrWhiteSpace(data))
                data = Path.Combine(Path.GetDirectoryName(outer), "NozeOmics_data");
            data = Path.GetFullPath(data);
            if (args.Contains("--quit") && !File.Exists(Path.Combine(data, "connection.json"))) return 0;
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            bool special = mcp || args.Contains("--background") || args.Contains("--quit");
            bool running = PortableUpdates.Running(data);
            string runtime = PortableUpdates.WithProgress(() => {
                string embedded = Extract(outer);
                // Serialize preparation/activation across launchers sharing this data home.
                string id;
                using (var sha = SHA256.Create()) id = Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(data.ToLowerInvariant()))).Replace('/', '_');
                using (var mutex = new Mutex(false, "Local\\NozeOmics-start-" + id)) {
                    try { if (!mutex.WaitOne(TimeSpan.FromMinutes(12))) throw new IOException("NozeOmics is still updating. Please try again shortly."); }
                    catch (AbandonedMutexException) { }
                    try {
                        var selected = PortableUpdates.Select(data, embedded, !special && !running);
                        if (!mcp) {
                            LaunchDesktop(selected, data, outer, args);
                            return null;
                        }
                        return selected.Runtime;
                    } finally { mutex.ReleaseMutex(); }
                }
            }, !special && !running);
            if (!mcp) return 0;
            string inner = Path.Combine(runtime, "NozeOmics.exe");
            string adapter = Path.Combine(runtime, "resources", "app", "mcp", "adapter.cjs");
            var info = new ProcessStartInfo(inner);
            info.UseShellExecute = false;
            info.WorkingDirectory = runtime;
            info.CreateNoWindow = true;
            info.EnvironmentVariables["NOZEOMICS_HOME"] = data;
            info.EnvironmentVariables["NOZEOMICS_EXE"] = outer;
            info.EnvironmentVariables["NOZEOMICS_LAUNCHER"] = outer;
            if (mcp)
            {
                info.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
                info.Arguments = Quote(adapter);
                info.RedirectStandardInput = info.RedirectStandardOutput = info.RedirectStandardError = true;
                using (var child = Process.Start(info))
                {
                    Task input = Pump(Console.OpenStandardInput(), child.StandardInput.BaseStream);
                    input.ContinueWith(task => { try { child.StandardInput.Close(); } catch { } });
                    Task output = Pump(child.StandardOutput.BaseStream, Console.OpenStandardOutput());
                    Task error = Pump(child.StandardError.BaseStream, Console.OpenStandardError());
                    child.WaitForExit();
                    Task.WaitAll(output, error);
                    return child.ExitCode;
                }
            }
            info.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            info.Arguments = String.Join(" ", args.Select(Quote));
            Process.Start(info);
            return 0;
        }
        catch (Exception error)
        {
            if (mcp) Console.Error.WriteLine("NozeOmics: " + error.Message);
            else MessageBox.Show(error.Message, "NozeOmics", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    internal static void LaunchDesktop(UpdateSelection selected, string data, string outer, string[] args)
    {
        // A background AI connection may have opened the app during download.
        // Keep that running session; use the downloaded update on its next start.
        if (selected.Pending && PortableUpdates.Running(data)) {
            selected.Runtime = selected.PreviousRuntime; selected.Pending = false;
        }
        var info = new ProcessStartInfo(Path.Combine(selected.Runtime, "NozeOmics.exe")) {
            UseShellExecute = false, WorkingDirectory = selected.Runtime, CreateNoWindow = true,
            Arguments = String.Join(" ", args.Select(Quote))
        };
        info.EnvironmentVariables["NOZEOMICS_HOME"] = data;
        info.EnvironmentVariables["NOZEOMICS_EXE"] = outer;
        info.EnvironmentVariables["NOZEOMICS_LAUNCHER"] = outer;
        info.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        string receipt = Path.Combine(Path.GetTempPath(), "NO", "startup-" + Guid.NewGuid().ToString("N") + ".json");
        if (selected.Pending) info.EnvironmentVariables["NOZEOMICS_STARTUP_RECEIPT"] = receipt;
        Process process;
        try { process = Process.Start(info); }
        catch (Exception error) {
            if (!selected.Pending) throw;
            PortableUpdates.Log(data, "Updated executable could not launch: " + error.Message);
            PortableUpdates.Reject(data, selected);
            info.FileName = Path.Combine(selected.PreviousRuntime, "NozeOmics.exe"); info.WorkingDirectory = selected.PreviousRuntime;
            info.EnvironmentVariables.Remove("NOZEOMICS_STARTUP_RECEIPT"); Process.Start(info); return;
        }
        using (var child = process) {
            if (!selected.Pending) return;
            PortableUpdates.Progress("Starting updated NozeOmics…", -1);
            var elapsed = Stopwatch.StartNew(); bool ready = false;
            while (elapsed.Elapsed.TotalSeconds < 90 && !child.HasExited) {
                if (File.Exists(receipt)) {
                    try { var answer = PortableUpdates.Object(File.ReadAllText(receipt));
                        ready = PortableUpdates.Text(answer, "version") == selected.Version && PortableUpdates.Text(answer, "root") == Path.Combine(selected.Runtime, "resources", "app");
                    } catch { }
                    if (ready) break;
                }
                Thread.Sleep(100);
            }
            try { if (File.Exists(receipt)) File.Delete(receipt); } catch { }
            if (ready) { PortableUpdates.Commit(data, selected); return; }
            if (child.HasExited && child.ExitCode == 0 && PortableUpdates.Running(data)) {
                PortableUpdates.Log(data, "Existing application session kept; update deferred to its next startup."); return;
            }
            // Ask this isolated candidate to shut down gracefully before fallback.
            // Never stop unrelated user applications or delete project data.
            var quit = new ProcessStartInfo(info.FileName, "--quit") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = info.WorkingDirectory };
            quit.EnvironmentVariables["NOZEOMICS_HOME"] = data;
            quit.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            using (var request = Process.Start(quit)) request.WaitForExit(15000);
            if (!child.WaitForExit(20000)) throw new IOException("The updated app could not start or finish shutting down. Quit NozeOmics, then open it again.");
            PortableUpdates.Reject(data, selected);
            info.FileName = Path.Combine(selected.PreviousRuntime, "NozeOmics.exe"); info.WorkingDirectory = selected.PreviousRuntime;
            info.EnvironmentVariables.Remove("NOZEOMICS_STARTUP_RECEIPT");
            PortableUpdates.Progress("Opening previous version…", -1);
            Process.Start(info);
        }
    }

    private static async Task Pump(Stream source, Stream destination)
    {
        var buffer = new byte[8192];
        int count;
        while ((count = await source.ReadAsync(buffer, 0, buffer.Length)) > 0)
        {
            await destination.WriteAsync(buffer, 0, count);
            // MCP uses short JSON messages; do not hold one in a pipe buffer.
            await destination.FlushAsync();
        }
    }

    private static string Extract(string outer)
    {
        // Footer = SHA256 hex (64 bytes), payload length (8), magic (8).
        using (var file = File.OpenRead(outer))
        {
            if (file.Length < 80) throw new InvalidDataException("Incomplete portable executable.");
            file.Position = file.Length - 80;
            var footer = new byte[80];
            if (file.Read(footer, 0, footer.Length) != footer.Length || Encoding.ASCII.GetString(footer, 72, 8) != "NZOMICS1")
                throw new InvalidDataException("Missing NozeOmics runtime payload.");
            string hash = Encoding.ASCII.GetString(footer, 0, 64);
            if (hash.Length != 64 || hash.Any(c => !Uri.IsHexDigit(c))) throw new InvalidDataException("Invalid runtime signature.");
            long length = BitConverter.ToInt64(footer, 64);
            if (length <= 0 || length > file.Length - 80) throw new InvalidDataException("Invalid runtime length.");
            // Keep the extraction prefix short for Windows' legacy path limit.
            string cache = Path.Combine(Path.GetTempPath(), "NO", hash.Substring(0, 12));
            using (var mutex = new Mutex(false, "Local\\NozeOmics-unpack-" + hash))
            {
                try { if (!mutex.WaitOne(TimeSpan.FromMinutes(3))) throw new IOException("NozeOmics is still preparing its runtime. Please try again shortly."); }
                catch (AbandonedMutexException) { }
                try
                {
                    string ready = Path.Combine(cache, ".complete");
                    if (File.Exists(ready) && File.ReadAllText(ready) == hash && File.Exists(Path.Combine(cache, "NozeOmics.exe"))) return cache;
                    // Do not delete another extraction or a user's files.
                    if (Directory.Exists(cache)) cache += "-r" + Process.GetCurrentProcess().Id;
                    string stage = cache + "-b" + Process.GetCurrentProcess().Id;
                    Directory.CreateDirectory(stage);
                    using (var payload = new SliceStream(file, file.Length - 80 - length, length))
                    {
                        using (var sha = SHA256.Create())
                            if (BitConverter.ToString(sha.ComputeHash(payload)).Replace("-", "").ToLowerInvariant() != hash)
                                throw new InvalidDataException("The portable executable is damaged. Copy it again.");
                        payload.Position = 0;
                        using (var zip = new ZipArchive(payload, ZipArchiveMode.Read, true))
                        {
                        string prefix = Path.GetFullPath(stage).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                        foreach (var entry in zip.Entries)
                        {
                            string destination = Path.GetFullPath(Path.Combine(stage, entry.FullName));
                            if (!destination.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Unsafe runtime entry.");
                            if (String.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(destination); continue; }
                            Directory.CreateDirectory(Path.GetDirectoryName(destination));
                            using (var source = entry.Open())
                            using (var target = File.Create(destination)) source.CopyTo(target);
                        }
                        }
                    }
                    if (!File.Exists(Path.Combine(stage, "NozeOmics.exe"))) throw new InvalidDataException("Missing application runtime.");
                    File.WriteAllText(Path.Combine(stage, ".complete"), hash);
                    Directory.Move(stage, cache);
                    return cache;
                }
                finally { mutex.ReleaseMutex(); }
            }
        }
    }

    private static string Quote(string value)
    {
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            result.Append(c); slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
    }

    private sealed class SliceStream : Stream
    {
        private readonly Stream source; private readonly long start, length; private long position;
        public SliceStream(Stream source, long start, long length) { this.source = source; this.start = start; this.length = length; }
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return true; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return length; } }
        public override long Position { get { return position; } set { Seek(value, SeekOrigin.Begin); } }
        public override int Read(byte[] buffer, int offset, int count)
        {
            source.Position = start + position;
            int read = source.Read(buffer, offset, (int)Math.Min(count, length - position));
            position += read; return read;
        }
        public override long Seek(long offset, SeekOrigin origin)
        {
            long value = origin == SeekOrigin.Begin ? offset : origin == SeekOrigin.Current ? position + offset : length + offset;
            if (value < 0 || value > length) throw new IOException("Invalid payload position.");
            return position = value;
        }
        public override void Flush() { }
        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    }
}
