import time, subprocess, logging

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("auto_deploy")

AGENT_PACKAGE = "/home/menna/agent_packages/student_agents.zip"
DEPLOY_PATH = "/Users/halasoliman/student_agents"
SSH_USER = "halasoliman"
SSH_PASS = "hala1966"
LEASES_FILE = "/var/lib/dhcp/dhcpd.leases"
VLAN10_PREFIX = "192.168.10."

def get_active_leases():
    ips = set()
    try:
        with open(LEASES_FILE) as f:
            content = f.read()
        blocks = content.split("lease ")
        for block in blocks[1:]:
            if "binding state active" in block:
                ip = block.split("{")[0].strip()
                if ip.startswith(VLAN10_PREFIX):
                    ips.add(ip)
    except Exception as e:
        logger.error(f"Error reading leases: {e}")
    return ips

def is_agent_running(ip):
    """Check if EDR agent is already running on the remote machine"""
    try:
        result = subprocess.run([
            "sshpass", "-p", SSH_PASS,
            "ssh", "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=5",
            f"{SSH_USER}@{ip}",
            "ps aux | grep edr_agent | grep -v grep | wc -l"
        ], capture_output=True, text=True, timeout=10)
        count = int(result.stdout.strip())
        return count > 0
    except Exception:
        return False

def deploy_to(ip):
    try:
        logger.info(f"Deploying to {ip}")
        subprocess.run([
            "sshpass", "-p", SSH_PASS,
            "ssh", "-o", "StrictHostKeyChecking=no",
            f"{SSH_USER}@{ip}",
            f"mkdir -p {DEPLOY_PATH}"
        ], timeout=30, check=True)
        subprocess.run([
            "sshpass", "-p", SSH_PASS,
            "scp", "-o", "StrictHostKeyChecking=no",
            AGENT_PACKAGE,
            f"{SSH_USER}@{ip}:{DEPLOY_PATH}/"
        ], timeout=60, check=True)
        subprocess.run([
            "sshpass", "-p", SSH_PASS,
            "ssh", "-o", "StrictHostKeyChecking=no",
            f"{SSH_USER}@{ip}",
            f"cd {DEPLOY_PATH} && unzip -o student_agents.zip && bash start_student.sh"
        ], timeout=60)
        logger.info(f"✅ Deployed to {ip}")
    except Exception as e:
        logger.error(f"Failed to deploy to {ip}: {e}")

while True:
    leases = get_active_leases()
    for ip in leases:
        if not is_agent_running(ip):
            logger.info(f"Agent not running on {ip} — deploying...")
            deploy_to(ip)
        else:
            logger.info(f"✅ Agent already running on {ip} — skipping")
    time.sleep(30)
