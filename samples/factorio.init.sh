# Prepare Software
sudo DEBIAN_FRONTEND=noninteractive apt update
sudo DEBIAN_FRONTEND=noninteractive apt upgrade
sudo mkdir /opt/factorio
sudo useradd factorio
sudo chown -R factorio:factorio /opt/factorio

cat << EOF | sudo tee /opt/factorio/update.sh
systemctl stop factorio
sudo -u factorio wget https://factorio.com/get-download/stable/headless/linux64 -O /opt/factorio/factorio_headless.tar.xz
sudo -u factorio tar -xJf /opt/factorio/factorio_headless.tar.xz -C /opt/factorio --strip-components=1
systemctl start factorio
EOF
sudo bash -c '[ ! -f /opt/factorio/bin/**/factorio ] && bash /opt/factorio/update.sh'
sudo -u factorio bash -c '[ ! -f /opt/factorio/saves/* ] && /opt/factorio/bin/x64/factorio --create /opt/factorio/saves/save.zip' # it doesn't make it's own save file on first run

# Define Service
cat << EOF | sudo tee /etc/systemd/system/factorio.service
[Unit]
Description=Factorio Server
Wants=network-online.target
After=network.target nss-lookup.target

[Service]
ExecStart=/opt/factorio/bin/x64/factorio --start-server-load-latest
User=factorio
Group=factorio
StandardOutput=journal
Restart=on-failure
WorkingDirectory=/opt/factorio

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable factorio
sudo systemctl start factorio
