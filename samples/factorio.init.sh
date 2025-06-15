sudo apt -y update
sudo apt -y upgrade
sudo mkdir /opt/factorio
sudo useradd factorio
sudo chown -R factorio:factorio /opt/factorio
sudo -u factorio bash -c '[ ! -f /opt/factorio/factorio_headless.tar.xz ] && \
wget https://factorio.com/get-download/stable/headless/linux64 -O /opt/factorio/factorio_headless.tar.xz && \
tar -xJf /opt/factorio/factorio_headless.tar.xz -C /opt/factorio --strip-components=1'
sudo -u factorio bash -c '[ ! -d /opt/factorio/saves ] && \
/opt/factorio/bin/x64/factorio --create ./saves/save.zip'

cat << EOF | sudo tee /etc/systemd/system/factorio.service
[Unit]
Description=Factorio Dedicated Server
Wants=network-online.target
After=syslog.target network.target nss-lookup.target

[Service]
Environment="LD_LIBRARY_PATH=./linux64"
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
